import Gio from 'gi://Gio';
import GLib from 'gi://GLib';


export class PlayerProcess {
    constructor({ playerPath, videoPath, scalingMode, loop, volume, framerate }) {
        this._playerPath = playerPath;
        this._videoPath = videoPath;
        this._scalingMode = scalingMode;
        this._loop = loop;
        this._volume = volume;
        this._framerate = framerate;

        this._pid = null;
        this._stdin = null;
        this._windows = [];
        this._windowSignal = null;
    }

    spawn() {
        const [success, pid, stdinFd] = GLib.spawn_async_with_pipes(
            null,
            [
                this._playerPath,
                this._videoPath,
                String(this._scalingMode),
                String(this._loop),
                String(this._volume),
                String(this._framerate),
            ],
            null,
            GLib.SpawnFlags.SEARCH_PATH,
            null
        );

        if (!success)
            throw new Error('PlayerProcess: failed to spawn player subprocess');

        this._pid = pid;

        const stdinStream = new Gio.UnixOutputStream({ fd: stdinFd, close_fd: true });
        this._stdin = new Gio.DataOutputStream({ base_stream: stdinStream });
    }

    waitForWindows(count, timeoutMs, callback, errback) {
        if (this._pid === null)
            throw new Error('PlayerProcess: call spawn() before waitForWindows()');

        const startTime = Date.now();

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const matched = global.get_window_actors()
                .map(a => a.get_meta_window())
                .filter(w => w.get_pid() === this._pid);

            if (matched.length >= count) {
                this._timeoutId = null;
                this._windows = matched;
                callback(matched);
                return GLib.SOURCE_REMOVE;
            }

            if (Date.now() - startTime > timeoutMs) {
                this.destroy();
                this._timeoutId = null;
                errback?.(`timed out (got ${matched.length}/${count})`);
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    play() {
        this._sendCommand('play');
    }

    pause() {
        this._sendCommand('pause');
    }

    _sendCommand(command) {
        if (!this._stdin) return;
        try {
            this._stdin.put_string(`${command}\n`, null);
        } catch (e) {
            console.error(`PlayerProcess: failed to send command "${command}":`, e);
        }
    }

    get pid() { return this._pid; }
    get windows() { return this._windows; }
    
    _cancelWindowWatch() {
        if (this._windowSignal !== null) {
            global.display.disconnect(this._windowSignal);
            this._windowSignal = null;
        }
    }

    destroy() {
        this._cancelWindowWatch();

        if (this._pid) {
            try { GLib.spawn_command_line_sync(`kill ${this._pid}`); } catch (_) {}
            this._pid = null;
        }

        this._windows = [];

        if (this._stdin) {
            try { this._stdin.close(null); } catch (_) {}
            this._stdin = null;
        }
    }
}