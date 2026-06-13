# Philips N4520 Home Assistant Card

This is the editable source area for the HACS dashboard card.

The current card:

- Reads a Home Assistant `media_player` entity.
- Displays current track metadata and progress.
- Calls standard `media_player` controls.
- Renders the photo-composited N4520 deck with rotating reels, moving rollers, VU needles, counter, and metadata sticker.
- Provides optional development-only level entity inputs.
- Can optionally connect to a Sendspin endpoint and derive VU levels from decoded PCM chunks.
- Generates fake VU meter behavior when no real level source is configured.

The HACS-installable artifact is `../../dist/philips-n4520-player.js`, with required image assets in `../../dist/assets/`.

## HACS Custom Repository

Until this is published as a default HACS repository, add it as a custom repository:

1. HACS -> three-dot menu -> Custom repositories.
2. Repository: this GitHub repository URL.
3. Category: Dashboard.
4. Install `Philips N4520 Player`.

Then add the card to a dashboard:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_player
name: Listening room
```

## Optional Level Entities

Development-only level entities can drive the meters directly:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_player
left_level_entity: sensor.n4520_left_db
right_level_entity: sensor.n4520_right_db
```

Use these for testing card meter behavior. They are not required for normal card use.

## Optional Sendspin VU Source

```yaml
type: custom:philips-n4520-player
entity: media_player.your_player
sendspin_enabled: true
ma_server_url: http://192.168.10.99:8095
sendspin_player_id: n4520_visualizer
sendspin_client_name: Philips N4520 Visualizer
sendspin_vu_calibration_db: 22
sendspin_vu_offset_ms: 0
sendspin_vu_timing_mode: absolute
sendspin_vu_window_ms: 25
sendspin_debug: false
```

If the endpoint requires direct auth, provide a token:

```yaml
sendspin_auth_token: YOUR_TOKEN
```

`sendspin_url` may be used instead of `ma_server_url` when you need to point directly at a `/sendspin` websocket/proxy endpoint. The card accepts `http`, `https`, `ws`, `wss`, and relative URLs.

The card uses the vendored `@sendspin/sendspin-js` runtime in `dist/vendor/sendspin-js/`. Sendspin delivers decoded, normalized PCM samples, so the card computes stereo RMS and maps it to the deck VU scale.

`sendspin_vu_calibration_db` sets the dBFS reference for `0 VU`; raise it if the meters read too low, or lower it if they pin too often. `sendspin_vu_offset_ms` delays or advances the displayed VU interpretation in milliseconds, from `-30000` to `30000`.

`sendspin_vu_timing_mode` controls timestamp mapping:

- `absolute`: default synchronized presentation timestamp.
- `timeline`: stable frame spacing anchored to local receipt time.
- `arrival`: websocket receipt time only.

`sendspin_vu_window_ms` controls how much decoded PCM is averaged into each VU frame. Lower values feel faster; higher values feel smoother.

Set `sendspin_debug: true` while tuning to show timing, queue, sample-rate, and level diagnostics in the card status line.

Each independently routed deck card should have its own Sendspin target. The default `sendspin_player_id` is derived from the configured `entity`, which is usually enough for cards tied to different media players. If you place multiple cards for the same media player on different dashboards, set explicit unique `sendspin_player_id` values to avoid target collisions.

The VU source priority is:

1. Explicit `left_level_entity` / `right_level_entity`.
2. Sendspin decoded PCM.
3. Fake VU fallback, when `fake_vu` is enabled.
