# Philips N4520 Player Visualizer

A static browser prototype for a Philips N4520 reel-to-reel styled audio player. It plays a local MP3 or FLAC file and drives the visualization from the Web Audio API.

The current visual approach is a photo-backed compositing prototype: the N4520 face is anchored by a reference photo, with animated overlays for the reels, tape path, capstan, VU needles, and peak LEDs. For a public/distributable version, replace `assets/n4520-reference.jpg` with an owned/licensed straight-on deck photograph or a rendered texture pass from a 3D model.

- supply and take-up reel rotation over the real deck geometry
- tape pack transfer from left reel to right reel
- moving tape path, capstan, and pinch roller
- stereo VU needles
- +3 dB and +6 dB peak LEDs
- basic transport controls

## Motion Model

The reel animation uses the N4520's 10.5 inch / 26.5 cm maximum reel size and the selected IPS speed. Reel angular speed is calculated from the current tape pack diameter:

```text
RPM = tape_speed_inches_per_second / (pi * current_pack_diameter_inches) * 60
```

The pack diameter changes by conserved winding area, so a nearly empty reel rotates faster than a nearly full reel. The pinch/capstan roller is a cropped photo asset and only lifts into the tape path while playing.

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
