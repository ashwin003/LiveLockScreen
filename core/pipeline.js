import Gst from 'gi://Gst';
import GLib from 'gi://GLib';

export default class Pipeline {
    constructor({ videoPath, volume, loop, framerate, skipFrame, dataCallback }) {
        this._videoPath = videoPath
        this._volume = volume
        this._loop = loop
        this._framerate = framerate
        this._dataCallback = dataCallback
        this._skipFrame = skipFrame ?? false
    
        this._pipeline = null;
        this._bus = null;

        this._videoSink = null;
        this._timeoutId = null; 

        this._initialized = false;
        this._firstFrame = true;
    }

    is_initialized() {
        return this._initialized
    }

    init() {
        if (this._initialized)
            return true;

        try {
            const videoBin   = new Gst.Bin({ name: 'video-bin' });
            const videoConvert  = Gst.ElementFactory.make('videoconvert', 'videoconvert');
            const videoSink  = Gst.ElementFactory.make('appsink', 'video-sink');

            if (!videoConvert || !videoSink) {
                throw new Error('Failed to create video elements');
            }

            videoSink.set_property('caps', Gst.Caps.from_string('video/x-raw,format=RGBA'));
            videoSink.set_property('max-buffers', 1);
            videoSink.set_property('drop', true);
            videoSink.set_property('sync', true);
            
            videoBin.add(videoConvert);
            videoBin.add(videoSink);
            videoConvert.link(videoSink);

            const videoGhostPad = Gst.GhostPad.new('sink', videoConvert.get_static_pad('sink'));
            videoBin.add_pad(videoGhostPad);

            let pipeline = Gst.ElementFactory.make('playbin', 'pipeline');
            if (!pipeline) {
                throw new Error('Failed to create playbin element')
            }
            pipeline.set_property('uri', GLib.filename_to_uri(this._videoPath, null));
            pipeline.set_property('video-sink', videoBin);

            if (this._volume > 0) {
                const audioBin      = new Gst.Bin({ name: 'audio-bin' });
                const audioConvert  = Gst.ElementFactory.make('audioconvert',  'audioconvert');
                const audioResample = Gst.ElementFactory.make('audioresample',  'audioresample');
                const audioSink     = Gst.ElementFactory.make('autoaudiosink',  'audio-sink');

                if (!audioConvert || !audioResample || !audioSink) {
                    throw new Error('Failed to create audio elements');
                }

                audioSink.set_property('sync', true);
                
                audioBin.add(audioConvert);
                audioBin.add(audioResample);
                audioBin.add(audioSink);
                audioConvert.link(audioResample);
                audioResample.link(audioSink);

                const audioGhostPad = Gst.GhostPad.new('sink', audioConvert.get_static_pad('sink'));
                audioBin.add_pad(audioGhostPad);
                pipeline.set_property('audio-sink', audioBin);
                pipeline.set_property('volume', this._volume);
            } else {
                const fakeSink = Gst.ElementFactory.make('fakesink', 'audio-fake');
                pipeline.set_property('audio-sink', fakeSink);
            }

            this._pipeline = pipeline;
            this._bus = pipeline.get_bus();
            this._videoSink = videoSink;

            this._initBusWatch();

            const interval = 1000 / this._framerate;
            this._timeoutId = this._startFetchTimer(interval)
            if (!this._timeoutId) {
                throw new Error('Failed to create the fetch timer')
            }

            this._initialized = true;
            return true;
        }
        catch(e) {
            console.error('Pipeline init failed: ', e.message);
            this.deinit();
            return false;
        }
    }

    _initBusWatch() {
        this._bus.add_watch(GLib.PRIORITY_DEFAULT, (bus, message) => {
            // When stream reaches its end -> seek back to 0
            if (this._loop && message.type === Gst.MessageType.EOS) {
                this._pipeline.seek_simple(
                    Gst.Format.TIME,
                    Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT,
                    0
                );
                this._firstFrame = true;
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
        
        // HACK:
        // Skipping first frame because it is a green screen sometimes
        if (this._skipFrame && this._firstFrame) {
            this._firstFrame = false;
            buffer = null;
            sample = null;
            return GLib.SOURCE_CONTINUE;
        }

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
        if (this._pipeline)
            this._pipeline.set_state(Gst.State.PLAYING);
    }

    pause() {
        if (this._pipeline)
            this._pipeline.set_state(Gst.State.PAUSED);
    }

    deinit() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._bus) {
            this._bus.remove_watch();
            this._bus = null;
        }
        if (this._pipeline) {
            this._pipeline.set_state(Gst.State.NULL);
            this._pipeline = null;
        }

        this._videoSink = null;
    }
}