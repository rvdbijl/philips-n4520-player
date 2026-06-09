# HA / MA Integration Support

This folder holds the Home Assistant and Music Assistant integration work.

- `home-assistant-card/`: source and notes for the HACS-installable custom card.
- `HA_MA_INTEGRATION_PLAN.md`: current architecture notes and the phased plan for real VU meter support through Music Assistant PCM analysis.

The HACS distributable card entry point is kept at `dist/philips-n4520-player.js` because HACS dashboard plugins must expose a matching JavaScript file from `dist/` or the repository root.
