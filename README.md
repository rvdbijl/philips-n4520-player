# Philips N4520 Player Visualizer

A static browser prototype for a Philips N4520 reel-to-reel styled audio player. It plays a local MP3 or FLAC file and drives the visualization from the Web Audio API.

![Philips N4520 player visualizer sample](assets/readme-sample.png)

The current visual approach is a photo-backed compositing prototype: the N4520 face is anchored by a supplied base photo with the reels removed and the powered-on VU meters already blended into the correct perspective. The displayed base image is `assets/n4520-deck-base-no-reels-powered-vu.png`. The reels are compositor-backed DOM image layers for smoother rotation, while the tape path, transport rollers, VU needles, and controls are overlaid in HTML/CSS/SVG. For a public/distributable version, replace the reference photos with owned/licensed straight-on captures or rendered texture passes from a 3D model.

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

## Visual References

- Primary front reference: `assets/n4520-reference.jpg`
- Supplied powered VU base image: `assets/n4520-deck-base-no-reels-powered-vu.png`
- Supplied orthographic reel reference: `assets/reel-ortho-reference.png`
- Extracted reel face texture: `assets/reel-front-face.png`
- Detail reference for future modeling: https://reverb.com/item/94457214-philips-n4520-reel-to-reel-tape-recorder-1-4-inch-4-track

## Verification

Install dependencies once:

```bash
npm install
npx playwright install chromium
```

With the local static server running on `http://localhost:4173/`:

```bash
npm run check
npm test
```

The Playwright test captures `test-results/n4520-render.png` for visual inspection.

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

## Home Assistant / Music Assistant Integration

The HA/MA integration work now lives in `integration-support/`.

- `integration-support/HA_MA_INTEGRATION_PLAN.md` records the architecture and phased plan.
- `integration-support/home-assistant-card/` contains the card source and HACS usage notes.
- `dist/philips-n4520-player.js` is the HACS dashboard plugin artifact.
- `dist/assets/` contains the deck image assets required by the HACS card.
- `hacs.json` declares the HACS display name and dashboard plugin filename.

Current HACS custom card configuration:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_music_assistant_player
name: Listening room
```

The current card uses Home Assistant `media_player` state for metadata, progress, controls, the reel sticker, and a fake VU fallback. Real VU meter support is planned for the next phase through a Music Assistant PCM analysis provider.
