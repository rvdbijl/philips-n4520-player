# Philips N4520 Music Assistant VU Provider

This folder contains the first Music Assistant side of the real VU meter path.

The provider in `n4520_vu/` is an experimental Music Assistant `audio_analysis`
provider. When MA streams audio through its PCM pipeline, the provider receives
raw PCM chunks, computes short stereo RMS/peak windows, and exposes the level
frame nearest to the MA queue's current playback position through a Music
Assistant API command.

It does not store raw audio and it does not persist Music Assistant audio
analysis records. It keeps a bounded in-memory buffer of already-reduced level
frames for the active playback queue, because MA may analyze audio faster than
the player consumes it.

## What It Provides

- Provider domain: `n4520_vu`
- Provider type: `audio_analysis`
- API command: `n4520_vu/levels`
- Debug API command: `n4520_vu/sessions`
- Frame size: 50 ms
- Retained reduced data: up to 20 minutes per active queue session
- Level output: stereo RMS and peak values, in dBFS and normalized `0..1`

The Home Assistant card is not wired to this command yet. This phase adds the
MA data source that the card can poll or subscribe to in the next phase.

## Installation

Music Assistant does not currently have a HACS-like custom provider install flow
for this kind of provider. The practical installation path is to place the
provider folder inside the Music Assistant server's provider directory and
restart MA.

Copy this folder:

```text
integration-support/music-assistant-provider/n4520_vu
```

into the MA server tree as:

```text
music_assistant/providers/n4520_vu
```

Then restart Music Assistant.

Depending on how MA is deployed, that means one of these approaches:

- Development checkout: copy `n4520_vu/` directly into
  `music_assistant/providers/`.
- Container: build a small custom image that copies `n4520_vu/` into
  `/app/music_assistant/providers/n4520_vu` or the equivalent path for that
  image.
- Home Assistant add-on: use a custom add-on image or an overlay/bind mount if
  your add-on setup supports it.

After restart, enable the provider in the Music Assistant provider settings if
it is not enabled automatically. Look for `Philips N4520 VU Levels`.

## Verifying

Start playback from Music Assistant to a player that uses MA's stream pipeline.
Then call the MA websocket API command:

```json
{
  "command": "n4520_vu/levels",
  "args": {
    "queue_id": "your_player_or_queue_id"
  }
}
```

If the provider has received PCM for that queue, it returns a payload like:

```json
{
  "available": true,
  "session_id": "music://track/...",
  "queue_id": "living_room",
  "position": 12.35,
  "age_ms": 80,
  "left_db": -10.2,
  "right_db": -9.7,
  "left": 0.83,
  "right": 0.84
}
```

If no MA queue stream is active, or the playback path bypasses MA's PCM
pipeline, it returns `available: false` with a reason.

## Playback Path Notes

This works when Music Assistant decodes or proxies the stream and the audio
buffer is active. MA playback to a Sonos player should be a valid target when
the Sonos device is playing the MA stream URL. It will not work for audio that
the Sonos speaker plays directly outside MA, because MA never sees the PCM.

## Next Step

The HA card should add an optional MA websocket configuration, poll
`n4520_vu/levels` at a modest rate, and fall back to fake VU behavior only when
the command reports no live level data.
