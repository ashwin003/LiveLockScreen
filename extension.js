import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import St from 'gi://St';
import Shell from 'gi://Shell';
import Gst from 'gi://Gst';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';

import Keys from "./enums.js";

export default class LockscreenExtension extends Extension {
    /* Called when screen is locked */
    enable() {
        if (!Main.screenShield._dialog) {
            return;
        }

        Gst.init(null);

        this._actors = [];
        this._images = [];
        
        this.audioPipeline = null;
        this.videoPipeline = null;

        this.pipelinesInited = false;

        this.videoSink = null;
        this.videoBus = null;

        this.timeoutId = null; // Timeout IDs
        this._injectionManager = null;
        
        this.settings = this.getSettings();

        // If not video set, fallback to default handler
        this.videoPath = this.settings.get_string(Keys.VIDEO_PATH)
        if (!this.videoPath) {
            return;
        }

        // These settings are common for all monitors
        const loop = this.settings.get_boolean(Keys.LOOPED);
        const blurBrightness = this.settings.get_double(Keys.BLUR_BRIGHTNESS);
        const blurRadius = this.settings.get_int(Keys.BLUR_RADIUS);
        const framerate = this.settings.get_int(Keys.FRAMERATE);
        const interval = 1000 / framerate;

        // Creating blur effect
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: blurRadius * themeContext.scale_factor,
            brightness: blurBrightness,
        };

        const backend = Clutter.get_default_backend();
        this.coglContext = backend.get_cogl_context();

        // Monkey-patching _createBackground method of Main.screenShield._dialog
        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(Main.screenShield._dialog, '_createBackground',
            (original) => {
                const self = this;
                return function(monitorIndex) {
                    // Fetching monitor information and creating image/actor per monitor
                    const monitor = Main.layoutManager.monitors[monitorIndex];
                    const image = St.ImageContent.new_with_preferred_size(
                        monitor.width, monitor.height
                    );
                    const videoActor = new Clutter.Actor({
                        x: monitor.x,
                        y: monitor.y,
                        width: monitor.width,
                        height: monitor.height,
                        content: image,
                    });
                    videoActor.add_effect(new Shell.BlurEffect(blurEffect));

                    self._actors.push(videoActor)
                    self._images.push(image)

                    // Initializing pipelines and timer here
                    if (self.pipelinesInited === false) {
                        self.videoPipeline = self._initVideoPipeline()
                        // If video pipeline creation failes, fallback to default
                        if (!self.videoPipeline) {
                            original.call(this, monitorIndex);
                            return
                        }
                        self.audioPipeline = self._initAudioPipeline()

                        self.videoSink = self.videoPipeline.get_by_name('sink');
                        self.videoBus = self.videoPipeline.get_bus()

                        self.timeoutId = self._initRenderTimer(interval)

                        if (loop)
                            self._loopPipelines()
                        
                        // Run both pipelines (checking if audio available)
                        self.videoPipeline.set_state(Gst.State.PLAYING)
                        if (self.audioPipeline) 
                            self.audioPipeline.set_state(Gst.State.PLAYING)

                        self.pipelinesInited = true
                    }

                    Main.screenShield._dialog._backgroundGroup.add_child(videoActor);
            }    
        });

        Main.screenShield._dialog._updateBackgrounds();
    }

    _initRenderTimer(interval) {
        return GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            let sample = this.videoSink.emit('try-pull-sample', 0);
            if (!sample) return GLib.SOURCE_CONTINUE;

            let buffer = sample.get_buffer();
            let caps = sample.get_caps();
            let structure = caps.get_structure(0);
            let [, width] = structure.get_int('width');
            let [, height] = structure.get_int('height');

            let [success, mapInfo] = buffer.map(Gst.MapFlags.READ);
            if (!success) return GLib.SOURCE_CONTINUE;
            
            this._images.forEach(image => {
                image.set_data(
                    this.coglContext,
                    mapInfo.data,
                    Cogl.PixelFormat.RGBA_8888,
                    width,
                    height,
                    width * 4
                );
            })

            buffer.unmap(mapInfo);

            // Explicitly null everything to help GC
            mapInfo = null;
            buffer = null;
            caps = null;
            structure = null;
            sample = null;

            return GLib.SOURCE_CONTINUE;
        });
    }

    _initAudioPipeline() {
        let enable = this.settings.get_boolean(Keys.AUDIO_ENABLE)
        if (!enable)
            return null;

        let volume = this.settings.get_int(Keys.AUDIO_VOLUME) / 100

        try {
            let pipeline = Gst.parse_launch(
                `filesrc location="${this.videoPath}" ! decodebin ! audioconvert ! volume volume=${volume} ! autoaudiosink`
            );
            return pipeline;
            
        } catch(e) {
            return null;
        }
    }

    _initVideoPipeline() {
        try {
            return Gst.parse_launch(
                `filesrc location="${this.videoPath}" ! decodebin ! videoconvert ! 
                video/x-raw,format=RGBA ! appsink name=sink max-buffers=1 drop=true sync=true`
            );
        } catch(e) {
            return null;
        }
    }

    _loopPipelines() {
        this.videoBus.add_watch(GLib.PRIORITY_DEFAULT, (bus, message) => {
            // When stream reaches its end -> seek back to 0
            if (message.type === Gst.MessageType.EOS) {
                this.videoPipeline.seek_simple(
                    Gst.Format.TIME,
                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                    0
                );

                if (this.audioPipeline) {
                    this.audioPipeline.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        0
                    );
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    /* Called when screen is unlocked */
    disable() {
        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }
        
        if (this.timeoutId) {
            GLib.source_remove(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.videoBus) {
            this.videoBus.remove_watch();
            this.videoBus.remove_signal_watch();
            this.videoBus = null;
        }
        if (this.videoSink) {
            this.videoSink.set_state(Gst.State.NULL);
            this.videoSink = null;
        }
        if (this.videoPipeline) {
            this.videoPipeline.set_state(Gst.State.NULL);
            this.videoPipeline = null;
        }
        if (this.audioPipeline) {
            this.audioPipeline.set_state(Gst.State.NULL);
            this.audioPipeline = null;
        }

        this.coglContext = null;
        this._actors.forEach(a => {
            a.remove_effect_by_name('lockscreen-extension-blur');
            a.destroy()
        });
        this._actors = [];
        this._images = [];
        this.pipelinesInited = false;
    }
}
