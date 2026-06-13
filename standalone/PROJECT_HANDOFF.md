# Standalone Visualizer Handoff

This note records calibration details for the preserved standalone browser prototype in this folder.

## Current Shape

The standalone app is a photo-composited Philips N4520 reel-to-reel visualizer. It plays local MP3/FLAC files with a lightweight browser player and uses the Web Audio API for VU motion.

- reels rotate using tape-speed physics
- tape packs transfer from left to right
- VU needles respond to audio
- +3/+6 VU LEDs light from the same scale mapping as the needles
- pinch roller and tensioner rollers are animated as separate photo layers
- transport buttons use the physical button positions on the deck photo

## Important Files

- `index.html`: DOM layers for the deck, transport assets, VU needles, LEDs, controls, and audio element.
- `styles.css`: visual placement, clipping, overlay sizing, and layer ordering.
- `app.js`: audio analyzer, transport state, reel/tape physics, VU scale mapping, and animation loop.
- `../assets/n4520-deck-base-no-transport.png`: active deck base image.
- `../assets/reel-front-face.png`: active reel texture.
- `../assets/reel-front-face-alpha1-backup.png`: saved fallback copy of the active reel texture before trying `reel alpha2.png`.
- `../assets/pinch-roller.png`: pinch roller cutout.
- `../assets/tensioner-left-new.png`: active tensioner cutout.

## Calibration Coordinates

The app uses a `1600 x 1200` coordinate system.

Current key coordinates in `app.js`:

- `leftReelCenter = { x: 511, y: 349 }`
- `rightReelCenter = { x: 1081, y: 351 }`
- `rollerRestCenter = { x: 914, y: 821 }`
- `rollerPlayCenter = { x: 914, y: 796 }`
- `leftTensionerRest = { x: 398, y: 752 }`
- `leftTensionerRun = { x: 391, y: 718 }`
- `leftTensionerKick = { x: 386, y: 688 }`
- `rightTensionerRest = { x: 1202, y: 752 }`
- `rightTensionerRun = { x: 1209, y: 718 }`
- `rightTensionerKick = { x: 1214, y: 688 }`

If the background image changes again, VU windows, LEDs, counter, tape path, and roller positions should be remeasured.

## Motion And Physics

Reel motion:

- maximum reel size: `10.5 in`
- full tape pack diameter: `9.35 in`
- empty visual pack diameter: `hubDiameterIn * 1.2`
- angular speed is derived from current tape pack diameter and selected IPS

VU meter mapping:

- displayed range is `-20 dB` to `+6 dB`
- full-scale audio peaks map to `+6 dB`
- the meter uses a piecewise `vuScale` table in `app.js`
- yellow LEDs are keyed to the red-zone start angle

## Known Fragile Areas

- The tape path is still a hand-tuned SVG path.
- The pinch roller occluder is an approximate CSS shape.
- The active reel is still a photo cutout, not a true 3D mesh.
- Several old reference assets remain in `../assets/` but are not active.

## Verification

Syntax check:

```bash
npm run check:standalone
```

Visual smoke test requires a local server at `http://localhost:4173/`:

```bash
npm test
```

The Playwright test writes `test-results/n4520-render.png` for inspection.
