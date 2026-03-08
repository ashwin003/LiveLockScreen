import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';

import { Keys } from './enums.js';
import { PlayerProcess } from './core/player_process.js';


export default class LockscreenExtension extends Extension {
    enable() {
        this._wrapperActors = [];
        this._windowActors = {};
        this._promptShown = false;
        this._injectionManager = null;
        this._player = null;

        this._settings = this.getSettings();

        const videoPath = this._settings.get_string(Keys.VIDEO_PATH);
        if (!videoPath) {
            console.warning('Video not set, falling back');
            return;
        }

        this._fadeInDuration  = this._settings.get_int(Keys.FADE_IN_DURATION);
        this._scalingMode = this._settings.get_int(Keys.SCALING_MODE);
        this._blurRadius = this._settings.get_int(Keys.BLUR_RADIUS);
        this._blurBrightness = this._settings.get_double(Keys.BLUR_BRIGHTNESS);

        const volume = this._settings.get_int(Keys.AUDIO_VOLUME) / 100;
        const loop = this._settings.get_boolean(Keys.LOOPED);
        const framerate = this._settings.get_int(Keys.FRAMERATE);

        this._promptSettings = {
            [Keys.PROMPT_PAUSE]:              this._settings.get_boolean(Keys.PROMPT_PAUSE),
            [Keys.PROMPT_CHANGE_BLUR]:        this._settings.get_boolean(Keys.PROMPT_CHANGE_BLUR),
            [Keys.PROMPT_BLUR_RADIUS]:        this._settings.get_int(Keys.PROMPT_BLUR_RADIUS),
            [Keys.PROMPT_BLUR_ANIM_DURATION]: this._settings.get_int(Keys.PROMPT_BLUR_ANIM_DURATION),
            [Keys.PROMPT_BLUR_BRIGHTNESS]:    this._settings.get_double(Keys.PROMPT_BLUR_BRIGHTNESS),
        };

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._blurRadius  *= themeContext.scale_factor;

        this._blurEffect = {
            name: 'lockscreen-extension-blur',
            radius: this._blurRadius,
            brightness: this._blurBrightness,
        };

        this._player = new PlayerProcess({
            playerPath: this.path + '/external/player_multi.js',
            videoPath,
            scalingMode: this._scalingMode,
            loop,
            volume,
            framerate,
        });

        try {
            this._player.run();
        } catch (e) {
            console.error('Failed to run video player! Falling back...', e);
            this._player = null;
            return;
        }


        // Temporarily hide all animations for windows
        this._injectionManager.overrideMethod(
            Main.wm,
            '_shouldAnimateActor',
            (original) => {
                return function(actor, types) {
                    return false;
                };
            }
        );

        const monitorCount = Main.layoutManager.monitors.length;
        this._player.waitForWindows(monitorCount, 10000, (data) => {
            let monitorIndex = 0;

            for (const win of data) {
                // Hiding window from list of visible windows
                // FIXME: Enable only for GNOME 49+
                // win.hide_from_window_list();
                // win.set_type(Meta.WindowType.DESKTOP);
                
                // Making window fullscreen on extension side
                // FIXME: 
                // Fullscreen window might cause other extensions (e.g. caffeine)
                // to fire, Need to come up with better alternative. Changing
                // frame size doesnt help, there is a small gap left
                win.move_to_monitor(monitorIndex);
                win.make_fullscreen();

                this._windowActors[monitorIndex++] = win.get_compositor_private();
            }

            this._injectCreateBackground();

            this._injectionManager.overrideMethod(
                Main.screenShield._dialog, '_showPrompt',
                (original) => {
                    const self = this;
                    return function(...args) {
                        original.call(this, ...args);
                        self._onPromptShow();
                    };
                }
            );

            this._injectionManager.overrideMethod(
                Main.screenShield._dialog, '_showClock',
                (original) => {
                    const self = this;
                    return function(...args) {
                        original.call(this, ...args);
                        self._onPromptHide();
                    };
                }
            );

            Main.screenShield._dialog._updateBackgrounds();
        }, (err) => {
            console.error(`Unable to intercept all windows: ${err}`);
        })
    }

    _injectCreateBackground() {
        this._injectionManager.overrideMethod(
            Main.screenShield._dialog, '_createBackground',
            (original) => {
                const self = this;
                return function(monitorIndex) {
                    original.call(this, monitorIndex);
                    self._handleMonitor(monitorIndex);
                };
            }
        );
    }

    _onPromptShow() {
        if (this._promptShown) return;
        this._promptShown = true;

        if (this._promptSettings[Keys.PROMPT_CHANGE_BLUR]) {
            const radius = this._promptSettings[Keys.PROMPT_BLUR_RADIUS];
            const brightness = radius ? this._promptSettings[Keys.PROMPT_BLUR_BRIGHTNESS] : 1;

            this._wrapperActors.forEach(actor => {
                actor.ease_property('@effects.lockscreen-extension-blur.radius', radius, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                actor.ease_property('@effects.lockscreen-extension-blur.brightness', brightness, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            })
        }
        
        if (this._promptSettings[Keys.PROMPT_PAUSE])
            this._player?.pause();
    }

    _onPromptHide() {
        if (!this._promptShown) return;
        this._promptShown = false;

        if (this._promptSettings[Keys.PROMPT_CHANGE_BLUR]) {
            const radius = this._blurRadius;
            const brightness = radius ? this._blurBrightness : 1;
            
            this._wrapperActors.forEach(actor => {
                actor.ease_property('@effects.lockscreen-extension-blur.radius', radius, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                actor.ease_property('@effects.lockscreen-extension-blur.brightness', brightness, {
                    duration: this._promptSettings[Keys.PROMPT_BLUR_ANIM_DURATION],
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            });
        }

        if (this._promptSettings[Keys.PROMPT_PAUSE])
            this._player?.play();
    }

    _handleMonitor(monitorIndex) {
        const isLastMonitor = monitorIndex === Main.layoutManager.monitors.length - 1;
        const windowActor = this._windowActors[monitorIndex];

        if (!windowActor) {
            console.warn(`No window actor for monitor ${monitorIndex}, skipping`);
            return;
        }

        const parent = windowActor.get_parent();
        if (parent) parent.remove_child(windowActor);

        const wrapper = new Clutter.Actor({
            x: 0, y: 0,
        });

        Main.screenShield._dialog._backgroundGroup.add_child(wrapper);
        Main.screenShield._dialog._backgroundGroup.set_child_above_sibling(wrapper, null);
        
        wrapper.add_effect(new Shell.BlurEffect(this._blurEffect));
        wrapper.opacity = 0;
        
        wrapper.add_child(windowActor);
        wrapper.set_child_above_sibling(windowActor, null);
        this._wrapperActors.push(wrapper)

        if (isLastMonitor) {
            this._initLoginManager();
            this._startAnimation();
        }
    }

    _startAnimation() {
        this._wrapperActors.forEach(actor => actor.ease({
            opacity: 255,
            duration: this._fadeInDuration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        }));
    }

    _initLoginManager() {
        this._loginManager = LoginManager.getLoginManager();
        this._sleepId = this._loginManager.connect('prepare-for-sleep', (_manager, aboutToSleep) => {
            if (!this._player) return;
            aboutToSleep ? this._player.pause() : this._player.play();
        });
    }

    disable() {
        // Return all window actors to window_group before destroying
        for (const windowActor of Object.values(this._windowActors)) {
            const parent = windowActor.get_parent();
            if (parent) parent.remove_child(windowActor);
            global.window_group.add_child(windowActor);
            windowActor.hide();
        }
        this._windowActors = {};

        this._player?.destroy();
        this._player = null;

        this._injectionManager?.clear();
        this._injectionManager = null;

        if (this._sleepId) {
            this._loginManager.disconnect(this._sleepId);
            this._sleepId = null;
        }

        this._wrapperActors.forEach(actor => {
            actor.remove_effect_by_name('lockscreen-extension-blur');
            actor.destroy()
        })
        this._wrapperActors = [];
    }
}
