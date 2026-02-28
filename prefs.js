import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Keys from "./enums.js";


export default class LiveLockscreenExtensionPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        window.set_default_size(600, 700);

        let page = new Adw.PreferencesPage();

        page.add(this._buildGeneralGroup(window))
        page.add(this._buildPlaybackGroup(window))
        page.add(this._buildEffectsGroup(window))

        window.add(page);
    }

    _buildGeneralGroup(window) {
        let generalGroup = new Adw.PreferencesGroup({
            title: 'General',
        });

        generalGroup.add(this._buildPathRow(window));

        let volumeRow = new Adw.SpinRow({
            title: 'Volume',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_int(Keys.AUDIO_VOLUME),
            }),
        });
        volumeRow.connect('notify::value', row => {
            window._settings.set_int(Keys.AUDIO_VOLUME, row.get_value());
        });
        generalGroup.add(volumeRow);

        const loopSwitch = new Adw.SwitchRow({
            title: 'Loop video',
        });
        window._settings.bind(
            Keys.LOOPED, loopSwitch, 
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        generalGroup.add(loopSwitch);

        return generalGroup;
    }

    _buildPlaybackGroup(window) {
        let playbackGroup = new Adw.PreferencesGroup({
            title: 'Playback',
        });

        let fpsRow = new Adw.SpinRow({
            title: 'Framerate',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 120,
                step_increment: 1,
                value: window._settings.get_int(Keys.FRAMERATE),
            }),
        });
        fpsRow.connect('notify::value', row => {
            window._settings.set_int(Keys.FRAMERATE, row.get_value());
        });
        playbackGroup.add(fpsRow);

        let fadeInRow = new Adw.SpinRow({
            title: 'Fade in',
            subtitle: 'Video fade-in animation duration',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 600 * 1000, // 10 minutes (I think thats big enough)
                step_increment: 100,
                value: window._settings.get_int(Keys.FADE_IN_DURATION),
            }),
        });
        // Add "ms" suffix label
        let suffix = new Gtk.Label({
            label: 'ms',
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        fadeInRow.add_suffix(suffix);
        fadeInRow.connect('notify::value', row => {
            window._settings.set_int(Keys.FADE_IN_DURATION, row.get_value());
        });
        playbackGroup.add(fadeInRow);

        return playbackGroup;
    }

    _buildEffectsGroup(window) {
        let effectsGroup = new Adw.PreferencesGroup({
            title: 'Effects',
        });

        let blurRadiusRow = new Adw.SpinRow({
            title: 'Blur radius',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_int(Keys.BLUR_RADIUS),
            }),
        });
        effectsGroup.add(blurRadiusRow);

        let blurBrightnessRow = new Adw.SpinRow({
            title: 'Blur brightness',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_double(Keys.BLUR_BRIGHTNESS) * 100,
            }),
        });
        effectsGroup.add(blurBrightnessRow);

        const toggleBrightnessSpin = () => {
            blurBrightnessRow.set_sensitive(blurRadiusRow.get_value() !== 0);
        };
        toggleBrightnessSpin();

        // Connecting signals
        blurRadiusRow.connect('notify::value', row => {
            window._settings.set_int(Keys.BLUR_RADIUS, row.get_value());
            toggleBrightnessSpin()
        });
        blurBrightnessRow.connect('notify::value', row => {
            window._settings.set_double(Keys.BLUR_BRIGHTNESS, row.get_value() / 100);
        });

        return effectsGroup;
    }

    _buildPathRow(window) {
        let path = window._settings.get_string(Keys.VIDEO_PATH);
        
        const row = new Adw.ActionRow({
            title: "Video",
            subtitle: `${path !== '' ? path : 'None'}`,
        });

        let button = new Adw.ButtonContent({
            icon_name: 'document-open-symbolic',
            label: 'Browse',
        });

        row.activatable_widget = button;
        row.add_suffix(button);

        row.connect('activated', () => {
            this._openFileDialog(window, row)
        });

        return row;
    }

    _openFileDialog(window, row) {
        let filter = new Gtk.FileFilter();
        filter.set_name('Video files');
        filter.add_mime_type('video/*');

        let filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);

        let dialog = new Gtk.FileDialog({ title: 'Select Video File' });
        dialog.set_filters(filters);
        dialog.open(window, null, (d, result) => {
            try {
                let file = d.open_finish(result);
                if (file) {
                    row.subtitle = file.get_path()
                    window._settings.set_string(Keys.VIDEO_PATH, file.get_path());
                }
                else {
                    row.subtitle = 'None'
                    window._settings.set_string(Keys.VIDEO_PATH, "");
                }
                
            } catch (e) {
                console.log(`Error selecting file: ${e}`);
            }
        });
    }
}
