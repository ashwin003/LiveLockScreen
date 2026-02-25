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

        this._pipelines = [];  // Gst pipelines
        this._timeoutIds = []; // Timeout IDs
        this._injectionManager = null;
        
        const settings = this.getSettings();

        // If not video set, fallback to default handler
        const videoPath = settings.get_string(Keys.VIDEO_PATH)
        if (!videoPath) {
            return;
        }

        // These settings are common for all monitors
        const loop = settings.get_boolean(Keys.LOOPED);
        const blurBrightness = settings.get_double(Keys.BLUR_BRIGHTNESS);
        const blurRadius = settings.get_int(Keys.BLUR_RADIUS);
        const framerate = settings.get_int(Keys.FRAMERATE);
        const interval = 1000 / framerate;

        // Creating blur effect
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        const blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: blurRadius * themeContext.scale_factor,
            brightness: blurBrightness,
        };

        const backend = Clutter.get_default_backend();
        const coglContext = backend.get_cogl_context();

        this._injectionManager = new InjectionManager();

        // Monkey-patching _createBackground method of Main.screenShield._dialog
        this._injectionManager.overrideMethod(Main.screenShield._dialog, '_createBackground',
            (original) => {
                const self = this;
                return function(monitorIndex) {
                    // Fetching monitor information and creating actor 
                    let monitor = Main.layoutManager.monitors[monitorIndex];
                    let image = St.ImageContent.new_with_preferred_size(
                        monitor.width, monitor.height
                    );
                    let videoActor = new Clutter.Actor({
                        x: monitor.x,
                        y: monitor.y,
                        width: monitor.width,
                        height: monitor.height,
                        content: image,
                    });
                    videoActor.add_effect(new Shell.BlurEffect(blurEffect));

                    // Building the pipeline
                    let pipeline = Gst.parse_launch(
                        `filesrc location="${videoPath}" ! decodebin ! videoconvert ! 
                        video/x-raw,format=RGBA ! appsink name=sink max-buffers=1 drop=true sync=true`
                    );
                    let sink = pipeline.get_by_name('sink');
                    
                    // Enabling timer to draw frames every N ms
                    let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
                        let sample = sink.emit('try-pull-sample', 0);
                        if (!sample) return GLib.SOURCE_CONTINUE;

                        let buffer = sample.get_buffer();
                        let caps = sample.get_caps();
                        let structure = caps.get_structure(0);
                        let [, width] = structure.get_int('width');
                        let [, height] = structure.get_int('height');

                        let [success, mapInfo] = buffer.map(Gst.MapFlags.READ);
                        if (!success) return GLib.SOURCE_CONTINUE;
                        
                        image.set_data(
                            coglContext,
                            mapInfo.data,
                            Cogl.PixelFormat.RGBA_8888,
                            width,
                            height,
                            width * 4,
                            null
                        );

                        buffer.unmap(mapInfo);
                        return GLib.SOURCE_CONTINUE;
                    });

                    // If looping is enabled add special event handler
                    if (loop) {
                        let bus = pipeline.get_bus();
                        bus.add_watch(GLib.PRIORITY_DEFAULT, (bus, message) => {
                            if (!self._pipelines.includes(pipeline)) 
                                    return GLib.SOURCE_REMOVE;

                            // When stream reaches its end -> seek back to 0
                            if (message.type === Gst.MessageType.EOS) {
                                pipeline.seek_simple(
                                    Gst.Format.TIME,
                                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                                    0
                                );
                            }
                            return GLib.SOURCE_CONTINUE;
                        });
                    }
                    
                    // Start pipeline playback
                    pipeline.set_state(Gst.State.PLAYING);

                    self._pipelines.push(pipeline);
                    self._timeoutIds.push(timeoutId);

                    Main.screenShield._dialog._backgroundGroup.add_child(videoActor);
            }    
        });

        if (Main.screenShield._dialog)
            Main.screenShield._dialog._updateBackgrounds();
    }

    _cleanup() {
        if (this._pipelines) {
            print(`${this._pipelines.length} pipelines cleaned`)
            this._pipelines.forEach(p => p.set_state(Gst.State.NULL));
            this._pipelines = [];
        }
        if (this._timeoutIds) {
            print(`${this._timeoutIds.length} timers cleaned`)
            this._timeoutIds.forEach(id => GLib.source_remove(id));
            this._timeoutIds = [];
        }
    }

    /* Called when screen is unlocked */
    disable() {
        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }
        this._cleanup()
    }
}
