#!/usr/bin/env gjs
/* 
 * This script runs multiple GTK windows with video output
 * on each of monitors
 * 
 * FIXME: Right now it's kind of a mess, gotta refactor 
*/

const Gtk = imports.gi.Gtk;
const Gst = imports.gi.Gst;
const Gio = imports.gi.Gio;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const GstController = imports.gi.GstController;

Gst.init(null);

const app = new Gtk.Application({
    flags: Gio.ApplicationFlags.FLAGS_NONE
});

const FADE_DURATION = 300

app.connect('activate', () => {
    let path = ARGV[0];
    let scalingMode = parseInt(ARGV[1])
    let loop = ARGV[2] == 'true'
    let volume = parseFloat(ARGV[3])
    let framerate = parseInt(ARGV[4])

    let css = new Gtk.CssProvider();
    css.load_from_string(`
    window {
        background: none;
        background-color: transparent;
    }
    picture {
        background: none;
        background-color: transparent;
    }
    * {
        background: none;
        transition: none;
        animation: none;
    }
    `);

    let scaling;
    //TODO: Hardcoded values for now. Use ./enums.js if possible
    switch(scalingMode) {
        case 0: scaling = Gtk.ContentFit.FILL; break;
        case 1: scaling = Gtk.ContentFit.CONTAIN; break;
        case 2: scaling = Gtk.ContentFit.COVER; break;
        default: scaling = Gtk.ContentFit.FILL;
    }

    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        css,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
    );

    //TODO: Hardcoded for now. Change to external argument
    let useVideorate = true;

    const pipeline = Gst.ElementFactory.make('playbin', 'playbin');
    let sink = null;

    if (useVideorate) {
        const videoSinkBin = Gst.parse_bin_from_description(
            `videorate skip-to-first=true ! 
            video/x-raw,framerate=${framerate}/1 ! 
            gtk4paintablesink name=sink`,
            true
        );
        sink = videoSinkBin.get_by_name('sink');
        pipeline.set_property('video-sink', videoSinkBin);

        
    } else {
        sink = Gst.ElementFactory.make('gtk4paintablesink', 'video-sink');
        pipeline.set_property('video-sink', sink);
    }


    const audioBin      = new Gst.Bin({ name: 'audio-bin' });
    const audioQueue    = Gst.ElementFactory.make('queue', 'audio-queue');
    const audioConvert  = Gst.ElementFactory.make('audioconvert',  'audioconvert');
    const audioResample = Gst.ElementFactory.make('audioresample',  'audioresample');
    const audioSink =     Gst.ElementFactory.make('autoaudiosink', 'audio-sink');
    const volumeElement = Gst.ElementFactory.make('volume', 'volume');

    if (!audioConvert || !audioResample || !audioSink || !audioQueue || !volumeElement) {
        throw new Error('Failed to create audio elements');
    }

    audioQueue.set_property('max-size-buffers', 0); // unlimited
    audioQueue.set_property('max-size-time', 5 * Gst.SECOND); // 2 second buffer
    audioQueue.set_property('max-size-bytes', 0); // unlimited

    audioSink.set_property('sync', true);
    
    audioBin.add(audioConvert);
    audioBin.add(audioResample);
    audioBin.add(audioQueue);
    audioBin.add(volumeElement);
    audioBin.add(audioSink);

    audioConvert.link(audioResample);
    audioResample.link(audioQueue);
    audioQueue.link(volumeElement);
    volumeElement.link(audioSink);

    const volumeControl = GstController.InterpolationControlSource.new();
    volumeControl.set_property(
        'mode',
        GstController.InterpolationMode.LINEAR
    );

    const binding = GstController.DirectControlBinding.new(
        volumeElement,
        'volume',
        volumeControl
    );

    volumeElement.add_control_binding(binding);
    volumeElement.set_property('volume', volume)

    const audioGhostPad = Gst.GhostPad.new('sink', audioConvert.get_static_pad('sink'));
    audioBin.add_pad(audioGhostPad);

    pipeline.set_property('audio-sink', audioBin);

    function easeVolume(target, durationMs = 300) {
        if (!volumeControl || !volumeElement)
            return;

        const clock = pipeline.get_clock();
        if (!clock) return;

        const now = clock.get_time();
        const base = pipeline.get_base_time();
        let runningTime = now - base;

        if (runningTime < 0 || runningTime === Gst.CLOCK_TIME_NONE) {
            runningTime = 0;
        }

        const startVol = volumeElement.volume;

        volumeControl.unset_all();

        const startTime = runningTime;
        const endTime = startTime + (durationMs * Gst.MSECOND);

        const safeStart = Math.max(0.0, Math.min(1.0, startVol));
        const safeTarget = Math.max(0.0, Math.min(1.0, target));

        // HACK: 
        // I have no idea why it requires me to divide the value by 10
        // But that seems to fix the issue
        volumeControl.set(startTime, safeStart / 10);
        volumeControl.set(endTime, safeTarget / 10);
    }

    const paintable = sink.get_property('paintable');

    const display = Gdk.Display.get_default();
    const gdkMonitors = display.get_monitors();
    const windows = [];

    for (let i = 0; i < gdkMonitors.get_n_items(); i++) {
        const gdkMonitor = gdkMonitors.get_item(i);

        const window = new Gtk.ApplicationWindow({
            application: app,
            title: 'Video Player',
        });

        const picture = new Gtk.Picture({
            paintable: paintable,
            content_fit: scaling,
            can_shrink: true,
            hexpand: true,
            vexpand: true,
        });

        window.set_child(picture);
        window.set_opacity(1);
        window.set_decorated(false);

        window.connect('realize', () => {
            window.get_surface().set_opaque_region(null);
            // Letting the extension handle this
            // window.fullscreen_on_monitor(gdkMonitor);
        });

        window.present();
        windows.push(window);
    }

    let uri = GLib.filename_to_uri(path, null);
    pipeline.set_property('uri', uri);
    pipeline.set_state(Gst.State.PLAYING);
    
    const bus = pipeline.get_bus();
    bus.add_signal_watch();
    bus.connect('message', (_, msg) => {
        if (loop && msg.type === Gst.MessageType.EOS) {
            pipeline.seek_simple(
                Gst.Format.TIME,
                Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                0
            );
        }
    });

    const stdin = new Gio.DataInputStream({
        base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false })
    });

    function readCommand() {
        stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (_, result) => {
            const [line] = stdin.read_line_finish(result);
            if (line) {
                const cmd = new TextDecoder().decode(line);
                if (cmd === 'pause') {
                    
                    easeVolume(0, FADE_DURATION);
                    GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT, 
                        FADE_DURATION + 50, 
                        () => {
                            const [ok, position] = pipeline.query_position(Gst.Format.TIME);
                            if (ok && position > 0) {
                                pipeline.seek_simple(
                                    Gst.Format.TIME,
                                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.ACCURATE,
                                    position
                                );
                            }
                            
                            pipeline.set_state(Gst.State.PAUSED);
                            playbackTimeoutId = null;
                            return GLib.SOURCE_REMOVE;
                    });
                }
                if (cmd == 'play') {
                    easeVolume(volume, FADE_DURATION);
                    pipeline.set_state(Gst.State.PLAYING)
                }
                if (cmd === 'quit') app.quit();
            }
            readCommand();
        });
    }

    readCommand();
});

app.run([]);
