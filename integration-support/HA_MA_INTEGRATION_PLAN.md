# Home Assistant / Music Assistant Integration Plan

## Goal

Turn the Philips N4520 browser visualization into a Home Assistant dashboard card or page that follows the currently playing Music Assistant player and drives the VU meters from real audio levels.

Real VU metering is required. Simulated VU movement is not acceptable beyond temporary development fallback states.

## Current Findings

The existing visualizer has two separable input surfaces:

- Transport and metadata state: play, pause, stop, position, duration, title, artist, album art, speed, and control actions.
- Audio level state: per-channel audio amplitude used for the VU needles and +3/+6 LEDs.

Home Assistant `media_player` entities can provide the first surface. They expose playback state, metadata, duration, position, volume, and standard control services. They do not expose PCM audio or realtime per-channel audio levels.

Music Assistant is the right place for the VU data. Current MA development sources include:

- `audio_analysis` providers that receive raw PCM chunks during streaming.
- `plugin` providers that can subscribe to MA events and register API commands.
- A WebSocket API that forwards MA events and handles registered API commands.

The relevant MA source references are:

- `music_assistant/providers/_demo_audio_analysis_provider`
- `music_assistant/models/audio_analysis_provider.py`
- `music_assistant/controllers/streams/audio_analysis.py`
- `music_assistant/providers/_demo_plugin_provider`
- `music_assistant/models/plugin.py`

## Feasibility

The HA card is straightforward for player state and controls.

The VU meter path is feasible inside Music Assistant, but not through normal HA entity state. HA state updates are too coarse and too expensive for smooth 10-20 Hz level data. The card should eventually connect to MA's WebSocket API, or to a small MA-provided endpoint, for live level data.

MA's audio analysis callback currently receives one-second PCM chunks. A VU provider can subdivide each chunk into smaller frame-aligned windows, compute stereo RMS/peak values, and pace updates to the frontend at a controlled rate.

## Phase 1: HACS Custom Card Scaffold

Status: HACS card and photo-composited visualization scaffold are in repo; shared-engine cleanup and MA PCM data are pending.

Deliverables:

- Root `hacs.json`.
- `dist/philips-n4520-player.js`, named to match the repository for HACS dashboard/plugin discovery.
- Required deck image assets in `dist/assets/`.
- Source copy under `integration-support/home-assistant-card/src/`.
- Documentation for HACS custom repository installation.
- Photo-composited deck view with reel, roller, tape, counter, VU needle, LED, transport hotspot, and left-reel metadata sticker layers.
- Fake VU fallback when no real level source is configured.
- Initial card config:
  - `entity`: required HA `media_player` entity.
  - optional `name`.
  - optional `ma_server_url` placeholder for the future direct MA WebSocket path.
  - optional `fake_vu`, defaulting to enabled while the MA PCM provider is not configured.
  - optional level entities for temporary development tests only.

The phase 1 card should not claim real VU support unless it receives real level data. Fake VU fallback is intentionally labeled in the UI.

## Phase 2: Music Assistant PCM Level Provider

Create an MA `audio_analysis` provider, `n4520_vu`.

Status: initial provider scaffold exists under
`integration-support/music-assistant-provider/n4520_vu`.

Responsibilities:

- Accept streaming analysis sessions.
- Decode PCM format details from MA session data.
- Compute stereo RMS and peak values from PCM.
- Slice one-second chunks into shorter windows. The first implementation uses
  50 ms windows.
- Provide raw reduced levels and let the card apply visual VU ballistics.
- Keep latest level state keyed by session and/or queue/player.
- Avoid storing full PCM buffers.
- Return `None` from `_finalize` unless we later decide to persist track-level summary analysis.

Implemented first provider behavior:

- Overrides MA's persisted-analysis version gate so every live stream can be
  accepted, even if the track was analyzed before.
- Stores only bounded in-memory reduced level frames for active queue sessions.
  This is intentionally position-addressable rather than latest-frame-only,
  because MA can process PCM analysis faster than the player consumes audio.
- Exposes `n4520_vu/levels` for current VU data.
- Exposes `n4520_vu/sessions` for diagnostics.
- Supports common little-endian PCM formats: 16-bit, 24-bit, 32-bit integer,
  32-bit float, and 64-bit float.
- Uses the MA queue's corrected elapsed time, when available, to return the
  frame nearest to actual playback position. If queue timing is unavailable, it
  returns the newest reduced frame.
- Rejects non-queue analysis sessions so background library scans do not fill
  memory with VU-only data.

Open design question:

- Whether live levels should be emitted as MA events from the analysis provider, exposed by a registered API command on a companion plugin provider, or added upstream as a formal MA audio-level event stream.

Preferred first implementation:

- An MA provider registers a lightweight API command, `n4520_vu/levels`.
- The card polls at a conservative rate or subscribes if a provider-specific event can be forwarded safely.
- If upstream MA accepts a custom event type or generic plugin event pattern, switch to push updates.

Installation constraint:

- MA currently discovers providers from its server-side provider directory. This
  repo can ship the provider source, but installation is not HACS-like. The
  folder must be copied, overlaid, or built into the MA server at
  `music_assistant/providers/n4520_vu`, then MA must be restarted and the
  provider enabled.

Playback constraint:

- This works for paths that pass through MA's decoded stream pipeline. Playback
  from MA to Sonos should work when Sonos is playing the MA stream URL. Direct
  native Sonos playback outside MA will not produce VU data because MA never
  receives the PCM.

## Phase 2B: Sendspin Card Visualizer Pivot

Status: first Home Assistant card pass implemented in v0.0.14.

Reason for pivot:

- The HA add-on copy test proved that a custom `audio_analysis` provider can be
  placed inside the MA container, but the MA UI does not expose that provider
  type in the normal add-provider list.
- Music Assistant already ships Sendspin browser client support and a
  server-side Sendspin proxy path.
- `@sendspin/sendspin-js` exposes `SendspinCore`, which can receive decoded PCM
  chunks without playing audible audio.

Implemented card behavior:

- Optional `sendspin_enabled` card config.
- Configurable `ma_server_url` / `sendspin_url`, optional
  `sendspin_auth_token`, `sendspin_player_id`, and `sendspin_client_name`.
- Vendored `@sendspin/sendspin-js` 3.2.0 in the HACS artifact so the card does
  not depend on a CDN.
- The card opens the Sendspin `/sendspin` websocket/proxy endpoint, optionally
  sends the MA auth message, adopts the socket into `SendspinCore`, and computes
  VU dB targets from decoded PCM chunks.
- Existing fake VU behavior remains as fallback.

Open integration question:

- Whether the card-created Sendspin client can be grouped cleanly with the real
  target player in the user's MA setup, especially for Sonos paths. If grouping
  does not route matching PCM to the card, the server-side audio-analysis
  provider remains the fallback path.

## Phase 3: Shared Visual Engine Cleanup

Move the existing standalone visual engine behind an adapter boundary:

- `setPlaybackState(state)`
- `setTransportState(state)`
- `setLevels(levels)`
- `callTransport(action)`

Then reuse the visual implementation in:

- standalone local-file demo mode
- Home Assistant card mode
- possible fullscreen HA panel/page mode

The photo assets need to be packaged in `dist/` for HACS because HACS only downloads dashboard plugin files from the first matching location it scans. If non-JS assets are required, all required assets should live in `dist/` with the card.

The current HACS card already contains a direct photo-composited deck implementation. Phase 3 should reduce duplication with the standalone visualizer and restore the more detailed standalone tape-path/transport physics where it materially improves the card.

## Risks

- Music Assistant custom provider installation may require a custom MA build, add-on overlay, or upstream contribution depending on deployment.
- Some playback paths may bypass MA's PCM pipeline. Those paths cannot produce real VU data from MA.
- Direct browser access to MA WebSocket must be checked for auth/CORS behavior in the target HA deployment, especially HA add-on ingress.
- HACS packaging wants a repository-level `dist/` artifact. If this repository remains both the standalone demo and the HACS card repo, release discipline matters.

## References Checked

- HACS dashboard/plugin repositories require JavaScript files in `dist/` or repository root, with one file matching the repository name.
- HACS `hacs.json` must be in the repository root and can specify `filename`.
- Home Assistant custom cards are custom elements and can access HA state and services via the frontend `hass` object.
- Home Assistant media player entities expose metadata, position, duration, state, volume, and controls.
- Music Assistant audio analysis providers receive PCM chunks during streaming.
- Music Assistant plugin providers can register custom API commands and interact with the event bus.
