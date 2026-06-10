"""Music Assistant audio-analysis provider for Philips N4520 VU levels."""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from struct import unpack_from
from typing import TYPE_CHECKING, Any

from music_assistant.models.audio_analysis_provider import (
    AnalysisSessionData,
    AudioAnalysisProvider,
)

if TYPE_CHECKING:
    from music_assistant_models.config_entries import ConfigEntry, ConfigValueType, ProviderConfig
    from music_assistant_models.media_items import AudioFormat
    from music_assistant_models.provider import ProviderManifest
    from music_assistant_models.streamdetails import StreamDetails

    from music_assistant.mass import MusicAssistant
    from music_assistant.models import ProviderInstanceType
    from music_assistant.models.audio_analysis import AudioAnalysisData


WINDOW_SECONDS = 0.050
MAX_FRAMES_PER_SESSION = 24000
FINISHED_SESSION_TTL_SECONDS = 600
DB_FLOOR = -60.0
MIN_DB_AMPLITUDE = 10 ** (DB_FLOOR / 20)


@dataclass(slots=True)
class LevelFrame:
    """Reduced audio level data for a short PCM window."""

    position: float
    left_db: float
    right_db: float
    left_peak_db: float
    right_peak_db: float
    left: float
    right: float
    left_peak: float
    right_peak: float
    updated_at: float


@dataclass(slots=True)
class LiveSession:
    """Rolling live VU data for one MA analysis session."""

    session_id: str
    queue_id: str | None
    uri: str | None
    item_id: str | None
    provider: str | None
    media_type: str | None
    sample_rate: int
    bit_depth: int
    channels: int
    content_type: str
    frames: deque[LevelFrame] = field(default_factory=lambda: deque(maxlen=MAX_FRAMES_PER_SESSION))
    processed_seconds: float = 0.0
    started_at: float = field(default_factory=time.monotonic)
    last_updated: float = field(default_factory=time.monotonic)
    finished_at: float | None = None


async def setup(
    mass: MusicAssistant, manifest: ProviderManifest, config: ProviderConfig
) -> ProviderInstanceType:
    """Initialize provider instance with the given configuration."""
    return N4520VUProvider(mass, manifest, config)


async def get_config_entries(
    mass: MusicAssistant,  # noqa: ARG001
    instance_id: str | None = None,  # noqa: ARG001
    action: str | None = None,  # noqa: ARG001
    values: dict[str, ConfigValueType] | None = None,  # noqa: ARG001
) -> tuple[ConfigEntry, ...]:
    """Return provider config entries."""
    return ()


class N4520VUProvider(AudioAnalysisProvider):
    """Live PCM level reducer for the Philips N4520 card."""

    analysis_version = 1

    def __init__(
        self,
        mass: MusicAssistant,
        manifest: ProviderManifest,
        config: ProviderConfig,
    ) -> None:
        """Initialize the provider."""
        super().__init__(mass, manifest, config)
        self._live_sessions: dict[str, LiveSession] = {}
        self._unregister_handles: list[Callable[[], None]] = []

    async def loaded_in_mass(self) -> None:
        """Register provider API commands."""
        await super().loaded_in_mass()
        self._unregister_handles.append(
            self.mass.register_api_command("n4520_vu/levels", self.get_levels)
        )
        self._unregister_handles.append(
            self.mass.register_api_command("n4520_vu/sessions", self.get_sessions)
        )

    async def start_analysis(
        self,
        session_id: str,
        streamdetails: StreamDetails,
        audio_format: AudioFormat,
    ) -> bool:
        """Start live analysis for every stream, bypassing persisted-analysis gating."""
        self._sessions[session_id] = AnalysisSessionData(
            streamdetails=streamdetails,
            audio_format=audio_format,
        )
        if not await self._start_analysis(session_id, streamdetails, audio_format):
            self._sessions.pop(session_id, None)
            return False
        return True

    async def _start_analysis(
        self,
        session_id: str,
        streamdetails: StreamDetails,
        audio_format: AudioFormat,
    ) -> bool:
        """Accept PCM sessions with a decodable integer or float sample format."""
        sample_rate = int(getattr(audio_format, "sample_rate", 0) or 0)
        bit_depth = int(getattr(audio_format, "bit_depth", 0) or 0)
        channels = int(getattr(audio_format, "channels", 0) or 0)
        content_type = _content_type_value(getattr(audio_format, "content_type", ""))
        queue_id = getattr(streamdetails, "queue_id", None)

        if sample_rate <= 0 or bit_depth not in (16, 24, 32, 64) or channels <= 0:
            self.logger.debug(
                "Rejecting VU analysis for unsupported PCM format: %s",
                audio_format,
            )
            return False
        if not queue_id:
            self.logger.debug("Rejecting VU analysis for non-playback session %s", session_id)
            return False

        for old_session_id, old_live in list(self._live_sessions.items()):
            if old_live.queue_id == queue_id:
                self._live_sessions.pop(old_session_id, None)

        self._live_sessions[session_id] = LiveSession(
            session_id=session_id,
            queue_id=queue_id,
            uri=getattr(streamdetails, "uri", None),
            item_id=getattr(streamdetails, "item_id", None),
            provider=getattr(streamdetails, "provider", None),
            media_type=_enum_value(getattr(streamdetails, "media_type", None)),
            sample_rate=sample_rate,
            bit_depth=bit_depth,
            channels=channels,
            content_type=content_type,
        )
        self.logger.debug(
            "Started N4520 VU analysis %s for queue=%s uri=%s format=%s/%s/%s",
            session_id,
            getattr(streamdetails, "queue_id", None),
            getattr(streamdetails, "uri", None),
            sample_rate,
            bit_depth,
            channels,
        )
        return True

    async def process_pcm_chunk(self, session_id: str, pcm_chunk: bytes) -> None:
        """Convert a PCM chunk into 50 ms level frames."""
        live = self._live_sessions.get(session_id)
        if live is None or not pcm_chunk:
            return

        bytes_per_sample = live.bit_depth // 8
        frame_size = bytes_per_sample * live.channels
        if frame_size <= 0:
            return

        sample_frames = len(pcm_chunk) // frame_size
        if sample_frames <= 0:
            return

        window_sample_frames = max(1, int(live.sample_rate * WINDOW_SECONDS))
        offset = 0
        while offset < sample_frames:
            count = min(window_sample_frames, sample_frames - offset)
            metrics = _window_metrics(
                pcm_chunk,
                offset,
                count,
                live.channels,
                live.bit_depth,
                live.content_type,
            )
            if metrics is not None:
                position = live.processed_seconds + (offset / live.sample_rate)
                live.frames.append(
                    LevelFrame(position=position, updated_at=time.monotonic(), **metrics)
                )
            offset += count

        live.processed_seconds += sample_frames / live.sample_rate
        live.last_updated = time.monotonic()

    async def _finalize(self, session_id: str) -> AudioAnalysisData | None:
        """Skip persisted MA audio-analysis records while retaining reduced frames."""
        if live := self._live_sessions.get(session_id):
            live.finished_at = time.monotonic()
            live.last_updated = live.finished_at
        return None

    async def cancel(self, session_id: str) -> None:
        """Cancel a live analysis session."""
        self._live_sessions.pop(session_id, None)
        await super().cancel(session_id)

    async def unload(self, is_removed: bool = False) -> None:
        """Unregister API commands and clear live session data."""
        for unregister in self._unregister_handles:
            unregister()
        self._unregister_handles.clear()
        self._live_sessions.clear()
        await super().unload(is_removed)

    async def get_levels(
        self,
        queue_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Return the best current VU frame."""
        self._prune_stale_sessions()
        live = self._select_session(queue_id=queue_id, session_id=session_id)
        if live is None:
            return {"available": False, "reason": "no_active_session"}
        if not live.frames:
            return {
                "available": False,
                "reason": "no_level_frames",
                "session_id": live.session_id,
                "queue_id": live.queue_id,
            }

        target_position = self._queue_position(live.queue_id) if live.queue_id else None
        frame = (
            _nearest_frame(live.frames, target_position)
            if target_position is not None
            else live.frames[-1]
        )
        return self._frame_payload(live, frame, target_position)

    async def get_sessions(self) -> list[dict[str, Any]]:
        """Return active VU analysis sessions for diagnostics."""
        self._prune_stale_sessions()
        now = time.monotonic()
        return [
            {
                "session_id": live.session_id,
                "queue_id": live.queue_id,
                "uri": live.uri,
                "item_id": live.item_id,
                "provider": live.provider,
                "media_type": live.media_type,
                "sample_rate": live.sample_rate,
                "bit_depth": live.bit_depth,
                "channels": live.channels,
                "content_type": live.content_type,
                "processed_seconds": round(live.processed_seconds, 3),
                "frame_count": len(live.frames),
                "age_ms": round((now - live.last_updated) * 1000),
                "finished": live.finished_at is not None,
            }
            for live in self._live_sessions.values()
        ]

    def _select_session(
        self,
        queue_id: str | None = None,
        session_id: str | None = None,
    ) -> LiveSession | None:
        """Select the requested or most likely active playback session."""
        if session_id:
            return self._live_sessions.get(session_id)

        candidates = list(self._live_sessions.values())
        if queue_id:
            candidates = [live for live in candidates if live.queue_id == queue_id]
        else:
            candidates = [live for live in candidates if live.queue_id]

        candidates = [live for live in candidates if self._queue_is_active(live.queue_id)]
        if not candidates:
            return None
        return max(candidates, key=lambda live: live.last_updated)

    def _queue_position(self, queue_id: str | None) -> float | None:
        """Return the MA queue's corrected elapsed time if available."""
        if not queue_id:
            return None
        queue = self.mass.player_queues.get(queue_id)
        if queue is None:
            return None
        position = getattr(queue, "corrected_elapsed_time", None)
        if position is None:
            position = getattr(queue, "elapsed_time", None)
        try:
            return float(position) if position is not None else None
        except (TypeError, ValueError):
            return None

    def _queue_is_active(self, queue_id: str | None) -> bool:
        """Return whether the queue still looks usable for live VU lookup."""
        if not queue_id:
            return False
        queue = self.mass.player_queues.get(queue_id)
        if queue is None:
            return False
        return bool(getattr(queue, "active", True))

    def _prune_stale_sessions(self) -> None:
        """Drop reduced frame buffers for sessions that are no longer useful."""
        now = time.monotonic()
        for session_id, live in list(self._live_sessions.items()):
            if (
                live.finished_at is not None
                and now - live.finished_at > FINISHED_SESSION_TTL_SECONDS
            ):
                self._live_sessions.pop(session_id, None)

    def _frame_payload(
        self,
        live: LiveSession,
        frame: LevelFrame,
        target_position: float | None,
    ) -> dict[str, Any]:
        """Serialize a VU frame for the MA websocket API."""
        now = time.monotonic()
        return {
            "available": True,
            "session_id": live.session_id,
            "queue_id": live.queue_id,
            "uri": live.uri,
            "item_id": live.item_id,
            "provider": live.provider,
            "media_type": live.media_type,
            "position": round(frame.position, 3),
            "target_position": round(target_position, 3) if target_position is not None else None,
            "age_ms": round((now - frame.updated_at) * 1000),
            "left_db": frame.left_db,
            "right_db": frame.right_db,
            "left_peak_db": frame.left_peak_db,
            "right_peak_db": frame.right_peak_db,
            "left": frame.left,
            "right": frame.right,
            "left_peak": frame.left_peak,
            "right_peak": frame.right_peak,
            "sample_rate": live.sample_rate,
            "bit_depth": live.bit_depth,
            "channels": live.channels,
            "content_type": live.content_type,
        }


def _window_metrics(
    data: bytes,
    frame_offset: int,
    frame_count: int,
    channels: int,
    bit_depth: int,
    content_type: str,
) -> dict[str, float] | None:
    """Compute stereo RMS and peak metrics for one PCM window."""
    bytes_per_sample = bit_depth // 8
    frame_size = bytes_per_sample * channels
    start = frame_offset * frame_size
    end = start + (frame_count * frame_size)
    if end > len(data):
        return None

    left_sum = 0.0
    right_sum = 0.0
    left_peak = 0.0
    right_peak = 0.0
    valid_frames = 0

    for cursor in range(start, end, frame_size):
        left = _read_sample(data, cursor, bit_depth, content_type)
        right = (
            _read_sample(data, cursor + bytes_per_sample, bit_depth, content_type)
            if channels > 1
            else left
        )
        left_sum += left * left
        right_sum += right * right
        left_peak = max(left_peak, abs(left))
        right_peak = max(right_peak, abs(right))
        valid_frames += 1

    if valid_frames == 0:
        return None

    left_rms = math.sqrt(left_sum / valid_frames)
    right_rms = math.sqrt(right_sum / valid_frames)
    left_db = _amplitude_to_db(left_rms)
    right_db = _amplitude_to_db(right_rms)
    left_peak_db = _amplitude_to_db(left_peak)
    right_peak_db = _amplitude_to_db(right_peak)
    return {
        "left_db": left_db,
        "right_db": right_db,
        "left_peak_db": left_peak_db,
        "right_peak_db": right_peak_db,
        "left": _db_to_unit(left_db),
        "right": _db_to_unit(right_db),
        "left_peak": _db_to_unit(left_peak_db),
        "right_peak": _db_to_unit(right_peak_db),
    }


def _read_sample(data: bytes, offset: int, bit_depth: int, content_type: str) -> float:
    """Read one little-endian PCM sample normalized to roughly -1.0..1.0."""
    if bit_depth == 16:
        return int.from_bytes(data[offset : offset + 2], "little", signed=True) / 32768.0
    if bit_depth == 24:
        raw = int.from_bytes(data[offset : offset + 3], "little", signed=False)
        if raw & 0x800000:
            raw -= 0x1000000
        return raw / 8388608.0
    if bit_depth == 32 and ("float" in content_type or "f32" in content_type):
        return _clamp_sample(unpack_from("<f", data, offset)[0])
    if bit_depth == 64 and ("float" in content_type or "f64" in content_type):
        return _clamp_sample(unpack_from("<d", data, offset)[0])
    if bit_depth == 32:
        return int.from_bytes(data[offset : offset + 4], "little", signed=True) / 2147483648.0
    return 0.0


def _clamp_sample(value: float) -> float:
    """Clamp float PCM values to the expected sample range."""
    if value > 1.0:
        return 1.0
    if value < -1.0:
        return -1.0
    return value


def _amplitude_to_db(amplitude: float) -> float:
    """Convert linear amplitude to dBFS with a fixed display floor."""
    db_value = 20 * math.log10(max(abs(amplitude), MIN_DB_AMPLITUDE))
    return round(max(DB_FLOOR, min(0.0, db_value)), 2)


def _db_to_unit(db_value: float) -> float:
    """Map the display dB range to 0..1 for simple frontend use."""
    return round(max(0.0, min(1.0, (db_value - DB_FLOOR) / abs(DB_FLOOR))), 4)


def _nearest_frame(frames: deque[LevelFrame], position: float | None) -> LevelFrame:
    """Return the frame nearest to a media position."""
    if position is None:
        return frames[-1]
    return min(frames, key=lambda frame: abs(frame.position - position))


def _content_type_value(content_type: Any) -> str:
    """Return a lowercase content type value from an enum or string."""
    return str(getattr(content_type, "value", content_type) or "").lower()


def _enum_value(value: Any) -> str | None:
    """Return a serializable enum value."""
    if value is None:
        return None
    return str(getattr(value, "value", value))
