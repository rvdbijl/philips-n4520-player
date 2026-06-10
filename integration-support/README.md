# HA / MA Integration Support

This folder holds the Home Assistant and Music Assistant integration work.

- `home-assistant-card/`: source and notes for the HACS-installable custom card.
- `music-assistant-provider/`: experimental MA `audio_analysis` provider that
  publishes live PCM-derived VU level frames.
- `HA_MA_INTEGRATION_PLAN.md`: current architecture notes and the phased plan for real VU meter support through Music Assistant PCM analysis.

The HACS distributable card entry point is kept at `dist/philips-n4520-player.js` because HACS dashboard plugins must expose a matching JavaScript file from `dist/` or the repository root.

The current preferred real-VU experiment is the card-side Music Assistant
Sendspin path. The card can connect to MA's `/sendspin` endpoint and use the
vendored `@sendspin/sendspin-js` runtime to derive levels from decoded PCM. The
MA `audio_analysis` provider remains in this folder as the server-side fallback
path if Sendspin grouping does not work for the target playback route.
