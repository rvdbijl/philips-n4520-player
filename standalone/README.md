# Standalone Browser Prototype

This folder preserves the original local-file JavaScript prototype. It plays a local MP3 or FLAC file in the browser and drives the N4520 visualization from the Web Audio API.

The repository's main purpose is now the Home Assistant card. Use this standalone version for visual calibration, asset experiments, and local playback testing.

## Run

From the repository root, start a static server:

```bash
python3 -m http.server 4173
```

Open:

```text
http://localhost:4173/standalone/
```

Choose a local audio file from the browser UI. Some browsers may require FLAC support from the operating system or browser build.

## Files

- `index.html`: deck structure and local-file controls.
- `styles.css`: standalone N4520 layout and overlays.
- `app.js`: audio analyzer, transport state, reel/tape physics, VU scale mapping, and animation loop.
- `../assets/`: shared image and Three.js assets.

## Checks

```bash
npm run check:standalone
```

The repository Playwright smoke test also targets this standalone route while the root static server is running.
