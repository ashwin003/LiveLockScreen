import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import St from 'gi://St';
import Gst from 'gi://Gst';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GstPbutils from 'gi://GstPbutils';

import Pipeline from './core/pipeline.js';
import PipelineUnsafe from './core/pipeline_unsafe.js';

import { Keys } from "./enums.js";
import { setImageData } from './utils/set_image_data.js';

import { createActor } from './core/scalers.js';

export default class LockscreenExtension extends Extension {
    /* Called when screen is locked */
    enable() {
        if (!Main.screenShield._dialog) {
            console.error('Failed to get screenShield._dialog object')
            return;
        }

        if (!Gst.is_initialized()) {
            if (!Gst.init(null)) {
                console.error('Failed to initialize Gstreamer')
                return;
            }
        }

        this._actors = [];
        this._images = [];

        this._injectionManager = null;
        this._settings = this.getSettings();

        // If not video set, fallback to default handler
        const videoPath = this._settings.get_string(Keys.VIDEO_PATH)
        if (!videoPath) {
            console.warning('Video not set, falling back')
            return;
        }

        let discoverer = new GstPbutils.Discoverer({ timeout: 3 * Gst.SECOND });
        let info = discoverer.discover_uri(GLib.filename_to_uri(
            videoPath, null
        ));
        let videoStreams = info.get_video_streams();
        if (videoStreams.length > 0) {
            let stream = videoStreams[0];
            this.width = stream.get_width();
            this.height = stream.get_height();
            console.log('video size:', this.width, this.height);
        }
        
        // These settings are common for all monitors
        this._fadeInDuration = this._settings.get_int(Keys.FADE_IN_DURATION);
        this._scalingMode = this._settings.get_int(Keys.SCALING_MODE);

        const loop = this._settings.get_boolean(Keys.LOOPED);
        const volume = this._settings.get_int(Keys.AUDIO_VOLUME) / 100
        const blurBrightness = this._settings.get_double(Keys.BLUR_BRIGHTNESS);
        const blurRadius = this._settings.get_int(Keys.BLUR_RADIUS);
        const framerate = this._settings.get_int(Keys.FRAMERATE);
        const skipFrame = this._settings.get_boolean(Keys.DEBUG_SKIP_FIRST_FRAME)
        const useUnsafePipeline = this._settings.get_boolean(Keys.DEBUG_USE_UNSAFE_PIPELINE)

        if (useUnsafePipeline) {
            this._pipeline = new PipelineUnsafe({
                videoPath: videoPath,
                volume: volume,
                loop: loop,
                framerate: framerate,
                dataCallback: this._drawImages.bind(this)
            })
        } else {
            this._pipeline = new Pipeline({
                videoPath: videoPath,
                volume: volume,
                loop: loop,
                framerate: framerate,
                skipFrame: skipFrame,
                dataCallback: this._drawImages.bind(this)
            })
        }
        

        // Creating blur effect
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: blurRadius * themeContext.scale_factor,
            brightness: blurBrightness,
        };

        const backend = Clutter.get_default_backend();
        this._coglContext = backend.get_cogl_context();

        // Monkey-patching _createBackground method of Main.screenShield._dialog
        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(Main.screenShield._dialog, '_createBackground',
            (original) => {
                const self = this;
                return function(monitorIndex) {
                    original.call(this, monitorIndex);
                    self._handleMonitor(monitorIndex);
            };
        });

        Main.screenShield._dialog._updateBackgrounds();
    }

    _handleMonitor(monitorIndex) {
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const isLastMonitor = monitorIndex === Main.layoutManager.monitors.length - 1;

        const { actor, container, image } = createActor({
            monitor,
            video_width: this.width, 
            video_height: this.height,
            scaling_mode: this._scalingMode,
        })

        let mainActor = container ? container : actor;
        print(mainActor)
        
        this._actors.push(mainActor);
        this._images.push(image);
        
        mainActor.add_effect(new Shell.BlurEffect(this._blurEffect));
        Main.screenShield._dialog._backgroundGroup.add_child(mainActor);
        Main.screenShield._dialog._backgroundGroup.set_child_above_sibling(mainActor, null);

        if (this._fadeInDuration > 0) {
            mainActor.opacity = 0;
        }

        if (isLastMonitor) {
            this._initPipeline();
            this._initLoginManager();
            this._startAnimation();
        }
    }

    _startAnimation() {
        this._actors.forEach(actor => actor.ease({
            opacity: 255,
            duration: this._fadeInDuration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        }))
    }

    _initLoginManager() {
        this._loginManager = LoginManager.getLoginManager();
        this._sleepId = this._loginManager.connect('prepare-for-sleep', (manager, aboutToSleep) => {
            if (!this._pipeline) return;
            aboutToSleep ? this._pipeline.pause() : this._pipeline.play();
        });
    }

    _initPipeline() {
        if (!this._pipeline.is_initialized()) {
            if (this._pipeline.init()) {
                this._pipeline.play()
            }
        }
    }

    _drawImages(data, width, height) {
        this._images.forEach(image => {
            setImageData(
                image,
                this._coglContext,
                data,
                Cogl.PixelFormat.RGBA_8888,
                width,
                height,
                width * 4
            )
        })
    }

    /* Called when screen is unlocked */
    disable() {
        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        if (this._sleepId) {
            this._loginManager.disconnect(this._sleepId);
            this._sleepId = null;
        }
        
        if (this._pipeline) {
            this._pipeline.deinit();
            this._pipeline = null;
        }

        this._coglContext = null;
        this._actors.forEach(a => {
            a.remove_effect_by_name('lockscreen-extension-blur');
            a.destroy()
        });
        this._actors = [];
        this._images = [];
    }
}
