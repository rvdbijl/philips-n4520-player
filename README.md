# Philips N4520 Player Visualizer

A static browser prototype for a Philips N4520 reel-to-reel styled audio player. It plays a local MP3 or FLAC file and drives the visualization from the Web Audio API:

- supply and take-up reel rotation
- tape pack transfer from left reel to right reel
- moving tape path, capstan, and pinch roller
- stereo VU needles
- +3 dB and +6 dB peak LEDs
- basic transport controls

Open `index.html` in a modern browser and choose a local audio file. Some browsers may require FLAC support from the operating system or browser build.

## Project Shape

This is intentionally dependency-free for the first version:

- `index.html` contains the deck structure and controls.
- `styles.css` renders the N4520-inspired faceplate, reels, meters, buttons, and responsive layout.
- `app.js` handles local audio playback, analyzer data, transport state, and animation.

## Future Music Assistant Integration

The current implementation keeps playback logic small so the visualizer can later become source-agnostic. A Home Assistant Music Assistant version should replace the local `<audio>` source with an adapter that provides:

- playback state: playing, paused, stopped, seeking
- track duration and current position
- level data or an audio analysis stream if available
- track metadata for the counter/display area

If Music Assistant only exposes player state and not PCM/audio analyzer data, the reel and counter motion can still follow player progress, while VU meter movement would need either a server-side analyzer, browser-accessible stream, or simulated meter response from volume/metadata.
