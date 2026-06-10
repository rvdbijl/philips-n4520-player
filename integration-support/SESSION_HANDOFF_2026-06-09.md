# Session Handoff - 2026-06-09

This note captures the Home Assistant / Music Assistant integration work so the project can be resumed without reconstructing the decisions and current state.

## Repository State

- Repository: `philips-n4520-player`
- Local path: `/home/robbert/projects/philips-n4520-player`
- Branch: `main`
- Remote: `git@github.com:rvdbijl/philips-n4520-player.git`
- HACS custom repository URL: `https://github.com/rvdbijl/philips-n4520-player`
- HACS category: Dashboard
- Current release version: `0.0.3`
- Tags pushed: `v0.0.1`, `v0.0.2`, `v0.0.3`

Recent pushed commits:

- `b87cdfb Add HACS Music Assistant player card`
- `29e22bb Refine HACS card transport visuals`
- `e48ebb0 Optimize HACS card animation`

Known dirty files at the end of the session:

- `app.js`
- `assets/readme-sample.png`

Those dirty files appear unrelated to the HACS card work and were intentionally left untouched.

## Integration Files

HACS and Home Assistant support currently lives in:

- `hacs.json`
- `dist/philips-n4520-player.js`
- `dist/assets/`
- `integration-support/HA_MA_INTEGRATION_PLAN.md`
- `integration-support/README.md`
- `integration-support/home-assistant-card/README.md`
- `integration-support/home-assistant-card/src/philips-n4520-player.js`

The source card and distributed HACS artifact should be kept identical unless a build step is added later:

- Source: `integration-support/home-assistant-card/src/philips-n4520-player.js`
- HACS artifact: `dist/philips-n4520-player.js`

Current version markers:

- `package.json`: `0.0.3`
- `package-lock.json`: `0.0.3`
- Card constant: `CARD_VERSION = "0.0.3"`

## HACS Install Path

Use this as a custom repository in HACS:

```text
https://github.com/rvdbijl/philips-n4520-player
```

Repository type/category:

```text
Dashboard
```

Minimal Lovelace card configuration:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_music_assistant_player
name: Listening room
```

Optional level-source configuration currently supported for development or future PCM-derived entities:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_music_assistant_player
left_level_entity: sensor.n4520_left_level
right_level_entity: sensor.n4520_right_level
```

If `left_level_entity` and `right_level_entity` are not configured, the VU meters use fake audio-reactive movement derived from playback state and metadata. This preserves the visual while the Music Assistant PCM path is not implemented.

## Current Card Behavior

The Home Assistant card ties to a configured `media_player` entity and provides transport controls:

- Play
- Pause
- Stop
- Previous track
- Next track

The card uses Home Assistant media player services and state:

- `media_player.media_play`
- `media_player.media_pause`
- `media_player.media_stop`
- `media_player.media_previous_track`
- `media_player.media_next_track`

The visual display consumes normal media player attributes where available:

- Artist
- Track title
- Album title
- Entity state
- Duration
- Position
- Position update timestamp

The display also includes a seven-segment-style counter derived from playback position.

## Visualization Details

The card now contains the full photo-composited N4520 visualization rather than the older simplified transport.

Current asset layers include:

- `deck-base-no-transport.png`
- `reel-front-face.png`
- `guide-roller-left-small.png`
- `pinch-roller.png`
- `tensioner-left-new.png`

Implemented visual components:

- Deck base photo layer
- Left and right reel faces
- Tape packs
- Tensioner rollers
- Guide rollers
- Pinch roller
- Head assembly occluder
- Static tape path
- VU meter needles
- Status LEDs
- Transport buttons / hotspots
- Seven-segment counter
- Metadata readout
- Handwritten-style sticker on the left reel

The handwritten sticker:

- Appears on the left reel only.
- Rotates with the left reel because it is inside the `.left-reel` transform group.
- Shows artist, track title, and album title.
- Was moved to a lower-left metal area to avoid obscuring the left reel gaps.

The pinch roller:

- Is visually covered by an added head-assembly occluder when engaged.
- This was added because the standalone visualization obscured the roller under the head assembly, while the first card pass did not.

Speed:

- The speed selector from the standalone visualization is not exposed in the card.
- The card defaults to the slowest visual transport speed: `3.75 IPS`.

## Tape Path Notes

The initial HACS card accidentally used an older/simple tape path. It was later updated to follow the newer visualization geometry.

Current behavior:

- The path is static on screen.
- It follows current roller and pack positions.
- It is not visually animated.
- It includes the newer head-cover entry and exit points:
  - Left head-cover point around `596,741`
  - Right head-cover point around `1000,728`
- It uses reel pack radii, tensioner positions, guide rollers, head-cover points, and arcs.

The tape path no longer uses:

- `stroke-dasharray`
- `tape-run`
- moving class names for tape animation

This was intentional. The user wanted the tape path to be a static view that follows roller positions, not an animated tape run.

## Animation Optimization

The card originally stuttered inside Home Assistant. The likely causes were high-frequency JavaScript updates, SVG path churn, and Home Assistant's own dashboard rendering overhead.

Implemented optimizations:

- Continuous reel and roller motion moved to CSS/Web Animations.
- JavaScript no longer writes reel/roller transforms every frame.
- JS only updates animation durations based on transport speed and tape pack diameter.
- VU needle updates are throttled to roughly 30 fps.
- State, progress, and geometry synchronization are throttled.
- Tape path and tape pack geometry are quantized to 0.5 percent progress increments.
- Tape path animation was removed entirely.
- `IntersectionObserver` pauses the animation loop when the card is offscreen.

Relevant animation names:

- `reel-spin`
- `roller-spin-cw`
- `roller-spin-ccw`

Remaining HA-specific risks:

- Home Assistant dashboard load can still affect smoothness if many cards are visible.
- Browser/device GPU performance matters.
- Large background images and multiple SVG/CSS layers can still cost paint time.

The current implementation should be substantially smoother than the first HACS version because the browser compositor handles continuous reel and roller rotation.

## Verification Completed

Commands/checks completed during the session:

```bash
npm run check
```

Result: passed.

```bash
cmp -s integration-support/home-assistant-card/src/philips-n4520-player.js dist/philips-n4520-player.js
```

Result: passed.

Browser smoke tests were also run through Playwright against a local static test page. They verified:

- Card/deck loaded.
- Sticker displayed metadata.
- Fake VU needle moved.
- Counter segments rendered.
- Tape path used the newer head-cover geometry and arcs.
- Tape path did not use dash animation.
- Tape path stayed stable across a short playback interval.
- CSS reel and roller animations were active.

Temporary local HTTP server work was checked and not intentionally left running.

## Phase Plan

### Phase 1 - HACS Card Validation

Install the custom repository in HACS and add the card to a dashboard using a Music Assistant-backed `media_player` entity.

Validate in real Home Assistant:

- Resource loads from HACS.
- Card appears in Lovelace.
- Transport controls work against the selected media player.
- Metadata updates correctly.
- Fake VU fallback behaves acceptably.
- Reel sticker position is acceptable across common metadata lengths.
- Tape path, head occluder, pinch roller, and reel gap alignment look correct on real dashboard sizes.
- Animation smoothness is acceptable on the target HA dashboard hardware.

Likely next card iteration:

- Tune any remaining layer alignment against screenshots from real HA.
- Consider exposing visual size/aspect options only if necessary.
- Bump version to `0.0.4` for the next HACS test release.

### Phase 2 - Music Assistant PCM Analysis

The VU meters are a deal-breaker if they cannot reflect real audio. The best path is therefore inside Music Assistant rather than Home Assistant alone.

Target direction:

- Add or extend a Music Assistant-side integration/provider/plugin path that can observe or derive PCM/audio level data.
- Publish left/right levels into Home Assistant, likely as sensor entities or via a websocket/API bridge consumed by the card.
- Keep the HA card able to consume `left_level_entity` and `right_level_entity`.
- Preserve fake VU fallback for unsupported players, idle state, development, or degraded operation.

Open Music Assistant questions for the next phase:

- Exact custom integration/provider extension points available in the currently installed Music Assistant version.
- Whether MA exposes decoded PCM, player stream taps, DSP hooks, or only metadata/control APIs.
- Whether per-player audio data can be sampled centrally or must be handled per output/player type.
- Latency and update-rate limits for sending level data to Home Assistant.
- Best HA-facing transport for level data: sensors, websocket event stream, or custom integration entity.

Technical constraints to keep in mind:

- Home Assistant card JavaScript cannot directly access arbitrary raw audio from Music Assistant due to browser, network, and media pipeline boundaries.
- Real VU behavior requires the data source to be near the audio stream or decoder.
- Level updates should be lightweight and probably downsampled to visual rates around 20-30 fps.

## Resume Checklist

1. Install `https://github.com/rvdbijl/philips-n4520-player` in HACS as a Dashboard repository.
2. Add the minimal Lovelace card YAML using a real Music Assistant media player.
3. Verify transport control and metadata in Home Assistant.
4. Capture any visual alignment issues from real HA.
5. If changes are needed, update both source and `dist` artifact.
6. Run `npm run check`.
7. Confirm source and dist match with `cmp -s`.
8. Bump version to `0.0.4` for the next test release.
9. Commit, tag, and push when ready.
10. Start Music Assistant PCM feasibility work.
