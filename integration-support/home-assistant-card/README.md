# Philips N4520 Home Assistant Card

This is the source area for the HACS dashboard card.

The current card is phase 1 scaffolding:

- Reads a Home Assistant `media_player` entity.
- Displays current track metadata and progress.
- Calls standard `media_player` controls.
- Renders the photo-composited N4520 deck with rotating reels, moving rollers, VU needles, counter, and metadata sticker.
- Provides optional development-only level entity inputs.
- Generates fake VU meter behavior when no real PCM/level source is configured.
- Reserves `ma_server_url` for the later direct Music Assistant level stream.

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
