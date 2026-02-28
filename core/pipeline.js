import Gst from 'gi://Gst';
import GLib from 'gi://GLib';

export default class Pipeline {
    constructor({ videoPath, volume, loop, framerate, dataCallback }) {
        this._videoPath = videoPath
        this._volume = volume
        this._loop = loop
        this._framerate = framerate
        this._dataCallback = dataCallback
    
        this._videoPipeline = null;
        this._audioPipeline = null;

        this._videoSink = null;
        this._videoBus = null;

        this._timeoutId = null; 

        this._initialized = false;
    }

    is_initialized() {
        return this._initialized
    }

    init() {
        this._videoPipeline = this._initVideoPipeline()
        if (!this._videoPipeline)
            return false;

        this._audioPipeline = this._initAudioPipeline()

        this._videoSink = this._videoPipeline.get_by_name('sink');
        this._videoBus = this._videoPipeline.get_bus()

        if (!this._videoBus || !this._videoSink)
            return false;

        const interval = 1000 / this._framerate;
        this._timeoutId = this._startFetchTimer(interval)
        if (!this._timeoutId)
            return false;

        this._initBusWatch()

        this._initialized = true;
        return true;
    }

    resync() {
        // Stop both
        this._videoPipeline.set_state(Gst.State.PAUSED);
        if (this._audioPipeline)
            this._audioPipeline.set_state(Gst.State.PAUSED);

        // Get current video position
        let [, position] = this._videoPipeline.query_position(Gst.Format.TIME);

        // Seek audio to match video position
        if (this._audioPipeline && position !== Gst.CLOCK_TIME_NONE) {
            this._audioPipeline.seek_simple(
                Gst.Format.TIME,
                Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                position
            );
        }

        // Reassign clock
        let clock = this._videoPipeline.get_clock();
        if (clock && this._audioPipeline) {
            this._audioPipeline.use_clock(clock);
            this._audioPipeline.set_base_time(this._videoPipeline.get_base_time());
        }
    }

    _initAudioPipeline() {
        if (this._volume == 0)
            return null;

        try {
            let pipeline = Gst.parse_launch(
                `filesrc location="${this._videoPath}" ! decodebin ! audioconvert ! 
                volume volume=${this._volume} ! autoaudiosink`
            );
            return pipeline;
        } catch(e) {
            return null;
        }
    }

    _initVideoPipeline() {
        try {
            return Gst.parse_launch(
                `filesrc location="${this._videoPath}" ! decodebin ! videoconvert ! 
                video/x-raw,format=RGBA ! appsink name=sink max-buffers=1 drop=true sync=true`
            );
        } catch(e) {
            return null;
        }
    }

    _initBusWatch() {
        this._videoBus.add_watch(GLib.PRIORITY_DEFAULT, (bus, message) => {
            // When stream reaches its end -> seek back to 0
            if (this._loop && message.type === Gst.MessageType.EOS) {
                this._videoPipeline.seek_simple(
                    Gst.Format.TIME,
                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                    0
                );

                if (this._audioPipeline) {
                    this._audioPipeline.seek_simple(
                        Gst.Format.TIME,
                        Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                        0
                    );
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _startFetchTimer(interval) {
        return GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => this._fetchData());
    }

    _fetchData() {
        let sample = this._videoSink.emit('try-pull-sample', 0);
        if (!sample) return GLib.SOURCE_CONTINUE;

        let buffer = sample.get_buffer();
        let caps = sample.get_caps();
        let structure = caps.get_structure(0);
        let [, width] = structure.get_int('width');
        let [, height] = structure.get_int('height');

        let [success, mapInfo] = buffer.map(Gst.MapFlags.READ);
        if (!success) return GLib.SOURCE_CONTINUE;

        this._dataCallback(
            mapInfo.data, width, height
        )

        buffer.unmap(mapInfo);

        // Explicitly null everything to help GC
        mapInfo = null;
        buffer = null;
        caps = null;
        structure = null;
        sample = null;

        return GLib.SOURCE_CONTINUE;
    }

    play() {
        this._videoPipeline.set_state(Gst.State.PLAYING)
        if (this._audioPipeline) 
            this._audioPipeline.set_state(Gst.State.PLAYING)
    }

    pause() {
        this._videoPipeline.set_state(Gst.State.PAUSED)
        if (this._audioPipeline) 
            this._audioPipeline.set_state(Gst.State.PAUSED)
    }

    deinit() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._videoBus) {
            this._videoBus.remove_watch();
            this._videoBus.remove_signal_watch();
            this._videoBus = null;
        }
        if (this._videoPipeline) {
            this._videoPipeline.set_state(Gst.State.NULL);
            this._videoPipeline = null;
        }
        if (this._audioPipeline) {
            this._audioPipeline.set_state(Gst.State.NULL);
            this._audioPipeline = null;
        }
    }
}