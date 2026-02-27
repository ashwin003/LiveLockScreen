import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Keys from "./enums.js";


export default class LiveLockscreenExtensionPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        window.set_default_size(800, 600);

        let page = new Adw.PreferencesPage();

        page.add(this._buildGeneralGroup(window))
        page.add(this._buildBlurGroup(window))
        page.add(this._buildAudioGroup(window))

        window.add(page);
    }

    _buildGeneralGroup(window) {
        let generalGroup = new Adw.PreferencesGroup({
            title: 'General',
        });

        generalGroup.add(this._buildPathRow(window));

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
        generalGroup.add(fpsRow);

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

    _buildBlurGroup(window) {
        let blurGroup = new Adw.PreferencesGroup({
            title: 'Blur',
            description: 'Adjust background blur effect',
        });

        let intensityRow = new Adw.SpinRow({
            title: 'Radius',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_int(Keys.BLUR_RADIUS),
            }),
        });
        blurGroup.add(intensityRow);

        let brightnessRow = new Adw.SpinRow({
            title: 'Brightness',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_double(Keys.BLUR_BRIGHTNESS) * 100,
            }),
        });
        blurGroup.add(brightnessRow);

        const toggleBrightnessSpin = () => {
            brightnessRow.set_sensitive(intensityRow.get_value() !== 0);
        };
        toggleBrightnessSpin();

        // Connecting signals
        intensityRow.connect('notify::value', row => {
            window._settings.set_int(Keys.BLUR_RADIUS, row.get_value());
            toggleBrightnessSpin()
        });
        brightnessRow.connect('notify::value', row => {
            window._settings.set_double(Keys.BLUR_BRIGHTNESS, row.get_value() / 100);
        });

        return blurGroup;
    }

    _buildAudioGroup(window) {
        let audioGroup = new Adw.PreferencesGroup({
            title: 'Audio',
        });

        const audioSwitch = new Adw.SwitchRow({
            title: 'Enable audio',
        });
        window._settings.bind(
            Keys.AUDIO_ENABLE, audioSwitch, 
            'active', Gio.SettingsBindFlags.DEFAULT
        );
        audioGroup.add(audioSwitch);

        let volumeRow = new Adw.SpinRow({
            title: 'Volume',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1,
                value: window._settings.get_int(Keys.AUDIO_VOLUME),
            }),
        });
        audioGroup.add(volumeRow);

        const toggleVolumeRow = () => {
            volumeRow.set_sensitive(audioSwitch.active);
        };
        toggleVolumeRow();

        audioSwitch.connect('notify::active', toggleVolumeRow);
        volumeRow.connect('notify::value', row => {
            window._settings.set_int(Keys.AUDIO_VOLUME, row.get_value());
        });

        return audioGroup;
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
