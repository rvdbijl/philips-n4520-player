# Home Assistant Card Support

This folder holds the editable source and documentation for the Home Assistant dashboard card.

- `home-assistant-card/`: source and configuration notes for the HACS-installable custom card.

The HACS distributable entry point remains at `dist/philips-n4520-player.js`, with required card assets in `dist/assets/`, because HACS dashboard plugins must expose the JavaScript artifact from `dist/` or the repository root.

Keep these files in sync until a build step is introduced:

```text
integration-support/home-assistant-card/src/philips-n4520-player.js
dist/philips-n4520-player.js
```
