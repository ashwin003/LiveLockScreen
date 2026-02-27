<p align="center">
  <img src="icon.png?v=2" width="128" height="128" alt="Live Lock Screen icon">
</p>


# Live Lock Screen

A GNOME Shell extension that lets you set any video as your lock screen background.

> ⚠️ Only tested on GNOME 48/49 so far. Should work on GNOME 45+ but not guaranteed. Try at your own risk.

## Features

- 🎬 Play any video file as the lock screen background
- 🔁 Loop support
- 🖥️ Multiple monitor support (with automatic stretching)
- 🌫️ Blur effect with adjustable intensity and brightness
- 🎞️ Configurable framerate (1-120 fps)
- 🔊 Optional audio output with volume control

## Screenshots

<p align="center">
  <img src="screenshots/main-window.png" alt="Extension Preferences" width="600">
  <br><br>
  <img src="screenshots/lockscreen-clock.png" alt="Lock Screen with Clock" width="600">
  <br><br>
  <img src="screenshots/lockscreen-prompt.png" alt="Lock Screen with Password Prompt" width="600">
</p>

## TODO

- [ ] Test on GNOME 45, 46, 47
- [ ] Different image sizing modes (cover, fit, stretch)
- [ ] Pause video on system suspend, resume on wake (?)
- [ ] ~~Per-monitor video selection~~ — not planned, single pipeline is used for performance
- [ ] Publish to extensions.gnome.org

## Installation

### Manual

1. Clone the repository:
   ```bash
   git clone https://github.com/nick-redwill/LiveLockScreen.git
   ```

2. Copy to your extensions folder:
   ```bash
   cp -r LiveLockScreen ~/.local/share/gnome-shell/extensions/live-lockscreen@nick-redwill
   ```

3. Log out and back in, then enable the extension:
   ```bash
   gnome-extensions enable live-lockscreen@nick-redwill
   ```

4. Open the extension preferences and select your video file.

## Requirements

- GNOME Shell 48-49 (other versions untested)
- GStreamer with good/bad plugins:
  ```bash
  # Fedora
  sudo dnf install gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugins-ugly
  
  # Ubuntu/Debian
  sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly
  ```

## License

AGPL-3.0
