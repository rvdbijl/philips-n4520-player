# Philips N4520 Home Assistant Card

This is the source area for the HACS dashboard card.

The current card is phase 1 scaffolding:

- Reads a Home Assistant `media_player` entity.
- Displays current track metadata and progress.
- Calls standard `media_player` controls.
- Renders the photo-composited N4520 deck with rotating reels, moving rollers, VU needles, counter, and metadata sticker.
- Provides optional development-only level entity inputs.
- Can optionally connect to Music Assistant Sendspin and derive VU levels from
  decoded PCM chunks.
- Generates fake VU meter behavior when no real PCM/level source is configured.

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
entity: media_player.your_music_assistant_player
name: Listening room
```

Optional development-only level entities:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_music_assistant_player
left_level_entity: sensor.n4520_left_db
right_level_entity: sensor.n4520_right_db
```

Do not use HA sensor entities as the final VU transport. They are useful for testing only; phase 2 should stream levels from Music Assistant.

Optional Sendspin VU source:

```yaml
type: custom:philips-n4520-player
entity: media_player.your_music_assistant_player
sendspin_enabled: true
ma_server_url: http://192.168.10.99:8095
sendspin_player_id: n4520_visualizer
sendspin_client_name: Philips N4520 Visualizer
sendspin_vu_calibration_db: 22
sendspin_vu_offset_ms: 0
sendspin_vu_window_ms: 25
sendspin_debug: false
```

If the MA webserver requires direct auth, also provide a Music Assistant auth
token:

```yaml
sendspin_auth_token: YOUR_MA_TOKEN
```

`sendspin_url` may be used instead of `ma_server_url` when you need to point
directly at a `/sendspin` websocket/proxy endpoint. The card accepts `http`,
`https`, `ws`, `wss`, and relative URLs.

The card uses the vendored `@sendspin/sendspin-js` runtime in
`dist/vendor/sendspin-js/`. Sendspin delivers decoded, normalized PCM samples,
so the card computes stereo RMS and maps it to the deck VU scale. The
`sendspin_vu_calibration_db` value sets the dBFS reference for `0 VU`; raise it
if the meters read too low, or lower it if they pin too often.
`sendspin_vu_offset_ms` delays or advances the displayed VU interpretation in
milliseconds. It accepts values from `-30000` to `30000`. Use positive values
when the meter leads the audible playback; negative values apply received
frames immediately and can only truly advance the meter when Sendspin delivers
audio ahead of the speaker.
`sendspin_vu_window_ms` controls how much decoded PCM is averaged into each VU
frame. Lower values feel faster and more detailed; higher values feel smoother.
Set `sendspin_debug: true` while tuning to show the active timing source,
loaded offset config, sample rate, chunk duration, window duration, queue depth,
late frames, lead time, raw Sendspin absolute lead, and Sendspin time-sync error
in the card status line. The normal Sendspin timing source should be
`timeline/sync`, which uses Sendspin timestamps for stable frame spacing while
anchoring the VU display to local receipt time plus `sendspin_vu_offset_ms`.

Each independently routed deck card should have its own Sendspin target. The
default `sendspin_player_id` is derived from the configured `entity`, which is
usually enough for cards tied to different media players. If you place multiple
cards for the same media player on different dashboards, set explicit unique
`sendspin_player_id` values to avoid target collisions.

The VU source priority is:

1. Explicit `left_level_entity` / `right_level_entity`.
2. Music Assistant Sendspin decoded PCM.
3. Fake VU fallback, when `fake_vu` is enabled.
