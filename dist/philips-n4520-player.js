const CARD_VERSION = "0.0.14";
const DEFAULT_SENDSPIN_LIBRARY = new URL("./vendor/sendspin-js/index.js", import.meta.url).href;

const MEDIA_STATE_PLAYING = "playing";
const MEDIA_STATE_PAUSED = "paused";
const MEDIA_STATE_IDLE = "idle";

const ASSETS = {
  deck: new URL("./assets/n4520-deck-base-no-transport.png", import.meta.url).href,
  reel: new URL("./assets/reel-front-face.png", import.meta.url).href,
  guide: new URL("./assets/guide-roller-left-small.png", import.meta.url).href,
  pinch: new URL("./assets/pinch-roller.png", import.meta.url).href,
  tensioner: new URL("./assets/tensioner-left-new.png", import.meta.url).href,
};

const VU_SCALE = [
  { db: -20, angle: -32.0 },
  { db: -10, angle: -23.5 },
  { db: -7, angle: -17.4 },
  { db: -5, angle: -12.6 },
  { db: -3, angle: -7.7 },
  { db: -2, angle: -5.1 },
  { db: -1, angle: -2.5 },
  { db: 0, angle: 0 },
  { db: 1, angle: 5.3 },
  { db: 2, angle: 10.8 },
  { db: 3, angle: 16.4 },
  { db: 4, angle: 23.0 },
  { db: 5, angle: 30.0 },
  { db: 6, angle: 36.9 },
];

const SEGMENTS = {
  "0": "a b c d e f",
  "1": "b c",
  "2": "a b d e g",
  "3": "a b c d g",
  "4": "b c f g",
  "5": "a c d f g",
  "6": "a c d e f g",
  "7": "a b c",
  "8": "a b c d e f g",
  "9": "a b c d f g",
};

const REEL_DIAMETER_IN = 10.5;
const EMPTY_TAPE_DIAMETER_IN = 3.6;
const FULL_TAPE_DIAMETER_IN = 9.35;
const REEL_TEXTURE_SIZE = 588;
const LEFT_REEL_CENTER = { x: 511, y: 349 };
const RIGHT_REEL_CENTER = { x: 1081, y: 351 };
const LEFT_GUIDE_ROLLER_CENTER = { x: 506, y: 736 };
const RIGHT_GUIDE_ROLLER_CENTER = { x: 1094, y: 736 };
const LEFT_TENSIONER_REST = { x: 402, y: 763 };
const LEFT_TENSIONER_RUN = { x: 393, y: 722 };
const LEFT_TENSIONER_KICK = { x: 395, y: 695 };
const RIGHT_TENSIONER_REST = { x: 1199, y: 763 };
const RIGHT_TENSIONER_RUN = { x: 1207, y: 722 };
const RIGHT_TENSIONER_KICK = { x: 1204, y: 695 };
const GUIDE_ROLLER_RADIUS_PX = 45;
const TENSIONER_ROLLER_RADIUS_PX = 22;
const LEFT_HEAD_COVER_ENTRY = { x: 596, y: 741 };
const RIGHT_HEAD_COVER_EXIT = { x: 1000, y: 728 };
const SLOWEST_SPEED_IPS = 3.75;
const PINCH_ROLLER_DIAMETER_IN = 1.15;
const GUIDE_ROLLER_DIAMETER_IN = 1.35;
const TENSIONER_ROLLER_DIAMETER_IN = 0.95;
const REEL_ANIMATION_DURATION_THRESHOLD_MS = 250;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dbFromLinear(value) {
  if (!Number.isFinite(value) || value <= 0) return -60;
  return clamp(20 * Math.log10(Math.max(value, 0.001)), -60, 6);
}

function deriveSendspinUrl(config) {
  const raw = String(config?.sendspin_url || config?.ma_server_url || "").trim();
  if (!raw) return "";

  const endpoint = raw.endsWith("/sendspin") ? raw : `${raw.replace(/\/$/, "")}/sendspin`;
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) return endpoint;
  if (endpoint.startsWith("http://")) return endpoint.replace(/^http:\/\//, "ws://");
  if (endpoint.startsWith("https://")) return endpoint.replace(/^https:\/\//, "wss://");

  const url = new URL(endpoint, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function sendspinPlayerId(config) {
  if (config?.sendspin_player_id) return String(config.sendspin_player_id);
  const entity = String(config?.entity || "media_player");
  return `n4520_${hashString(entity).toString(16)}`;
}

function samplesToDb(samples) {
  if (!samples?.length) return -60;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Number(samples[i]) || 0;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(sum / samples.length);
  return dbFromLinear(Math.max(rms * 1.8, peak * 0.45));
}

function meterAngle(dbVu) {
  const value = clamp(Number(dbVu), -20, 6);
  for (let i = 1; i < VU_SCALE.length; i += 1) {
    const prev = VU_SCALE[i - 1];
    const next = VU_SCALE[i];
    if (value <= next.db) {
      const t = (value - prev.db) / (next.db - prev.db);
      return prev.angle + t * (next.angle - prev.angle);
    }
  }
  return VU_SCALE[VU_SCALE.length - 1].angle;
}

function correctedPosition(stateObj) {
  const attrs = stateObj?.attributes || {};
  const base = Number(attrs.media_position);
  if (!Number.isFinite(base)) return 0;
  if (stateObj.state !== MEDIA_STATE_PLAYING || !attrs.media_position_updated_at) return base;
  const updatedAt = Date.parse(attrs.media_position_updated_at);
  if (!Number.isFinite(updatedAt)) return base;
  return base + Math.max(0, (Date.now() - updatedAt) / 1000);
}

function tapePackPercent(progress, side) {
  const empty = EMPTY_TAPE_DIAMETER_IN * EMPTY_TAPE_DIAMETER_IN;
  const full = FULL_TAPE_DIAMETER_IN * FULL_TAPE_DIAMETER_IN;
  const tape = full - empty;
  const area = side === "left" ? full - progress * tape : empty + progress * tape;
  return clamp((Math.sqrt(area) / REEL_DIAMETER_IN) * 100, 34, 90);
}

function tapePackDiameter(progress, side) {
  const empty = EMPTY_TAPE_DIAMETER_IN * EMPTY_TAPE_DIAMETER_IN;
  const full = FULL_TAPE_DIAMETER_IN * FULL_TAPE_DIAMETER_IN;
  const tape = full - empty;
  const area = side === "left" ? full - progress * tape : empty + progress * tape;
  return Math.sqrt(area);
}

function packRadiusPx(diameterIn) {
  return (diameterIn / REEL_DIAMETER_IN) * (REEL_TEXTURE_SIZE / 2);
}

function mixPoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
  };
}

function tensionerPoint(rest, run, kick, lift, wobble) {
  const t = clamp(lift, 0, 1.22);
  const base = t <= 1
    ? mixPoint(rest, run, t)
    : mixPoint(run, kick, (t - 1) / 0.22);
  const curve = Math.sin(Math.min(1, t) * Math.PI);
  return {
    x: base.x + curve * wobble * 2.2,
    y: base.y - curve * Math.abs(wobble) * 1.3,
  };
}

function pointOnCircle(center, radius, degrees) {
  const radians = degrees * (Math.PI / 180);
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
}

function externalTangent(a, b, side) {
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const distanceSq = dx * dx + dy * dy;
  const radiusDelta = a.radius - b.radius;
  const tangentSq = distanceSq - radiusDelta * radiusDelta;
  if (distanceSq <= 0 || tangentSq <= 0) return null;

  const tangent = Math.sqrt(tangentSq);
  const vx = (dx * radiusDelta - dy * tangent * side) / distanceSq;
  const vy = (dy * radiusDelta + dx * tangent * side) / distanceSq;
  return {
    from: {
      x: a.center.x + vx * a.radius,
      y: a.center.y + vy * a.radius,
    },
    to: {
      x: b.center.x + vx * b.radius,
      y: b.center.y + vy * b.radius,
    },
  };
}

function arcSegment(circle, from, to) {
  const startAngle = Math.atan2(from.y - circle.center.y, from.x - circle.center.x);
  const endAngle = Math.atan2(to.y - circle.center.y, to.x - circle.center.x);
  const clockwiseDelta = (endAngle - startAngle + Math.PI * 2) % (Math.PI * 2);
  const sweep = clockwiseDelta <= Math.PI ? 1 : 0;
  return `A ${circle.radius.toFixed(1)} ${circle.radius.toFixed(1)} 0 0 ${sweep} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function arcSegmentWithSweep(circle, from, to, sweep) {
  return `A ${circle.radius.toFixed(1)} ${circle.radius.toFixed(1)} 0 0 ${sweep} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

function leftTensionerToGuideTangent(leftTensioner) {
  const tensionerCenter = { x: leftTensioner.x - 1.3, y: leftTensioner.y + 5.1 };
  return {
    from: {
      x: tensionerCenter.x - 8,
      y: tensionerCenter.y + TENSIONER_ROLLER_RADIUS_PX,
    },
    to: {
      x: LEFT_GUIDE_ROLLER_CENTER.x,
      y: LEFT_GUIDE_ROLLER_CENTER.y - GUIDE_ROLLER_RADIUS_PX - 5,
    },
  };
}

function tapePath(progress, playing) {
  const leftRadius = packRadiusPx(tapePackDiameter(progress, "left"));
  const rightRadius = packRadiusPx(tapePackDiameter(progress, "right"));
  const lift = playing ? 1 : 0;
  const leftTensioner = tensionerPoint(
    LEFT_TENSIONER_REST,
    LEFT_TENSIONER_RUN,
    LEFT_TENSIONER_KICK,
    lift,
    0,
  );
  const rightTensioner = tensionerPoint(
    RIGHT_TENSIONER_REST,
    RIGHT_TENSIONER_RUN,
    RIGHT_TENSIONER_KICK,
    lift,
    0,
  );
  const circles = [
    { center: LEFT_REEL_CENTER, radius: leftRadius },
    {
      center: { x: leftTensioner.x - 1.3, y: leftTensioner.y + 5.1 },
      radius: TENSIONER_ROLLER_RADIUS_PX,
    },
    { center: LEFT_GUIDE_ROLLER_CENTER, radius: GUIDE_ROLLER_RADIUS_PX },
    { center: RIGHT_GUIDE_ROLLER_CENTER, radius: GUIDE_ROLLER_RADIUS_PX },
    {
      center: { x: rightTensioner.x + 1.3, y: rightTensioner.y + 5.1 },
      radius: TENSIONER_ROLLER_RADIUS_PX,
    },
    { center: RIGHT_REEL_CENTER, radius: rightRadius },
  ];
  const reelToLeftTensioner = externalTangent(circles[0], circles[1], 1);
  const leftTensionerToGuide = leftTensionerToGuideTangent(leftTensioner);
  const leftGuideTapeCircle = {
    center: { x: LEFT_GUIDE_ROLLER_CENTER.x, y: LEFT_GUIDE_ROLLER_CENTER.y - 5 },
    radius: GUIDE_ROLLER_RADIUS_PX,
  };
  const leftGuideToCover = pointOnCircle(leftGuideTapeCircle.center, leftGuideTapeCircle.radius, -25);
  const rightGuideFromCover = pointOnCircle(RIGHT_GUIDE_ROLLER_CENTER, GUIDE_ROLLER_RADIUS_PX, -120);
  const rightGuideToTensionerBase = pointOnCircle(RIGHT_GUIDE_ROLLER_CENTER, GUIDE_ROLLER_RADIUS_PX, 42);
  const rightGuideToTensioner = {
    ...rightGuideToTensionerBase,
    y: rightGuideToTensionerBase.y - 45,
  };
  const rightTensionerBottom = pointOnCircle(circles[4].center, TENSIONER_ROLLER_RADIUS_PX, 90);
  const rightTensionerToReel = externalTangent(circles[4], circles[5], 1);
  if (!reelToLeftTensioner || !rightTensionerToReel) return "";

  return [
    `M ${reelToLeftTensioner.from.x.toFixed(1)} ${reelToLeftTensioner.from.y.toFixed(1)}`,
    `L ${reelToLeftTensioner.to.x.toFixed(1)} ${reelToLeftTensioner.to.y.toFixed(1)}`,
    `M ${leftTensionerToGuide.from.x.toFixed(1)} ${leftTensionerToGuide.from.y.toFixed(1)}`,
    `L ${leftTensionerToGuide.to.x.toFixed(1)} ${leftTensionerToGuide.to.y.toFixed(1)}`,
    arcSegmentWithSweep(leftGuideTapeCircle, leftTensionerToGuide.to, leftGuideToCover, 1),
    `M ${LEFT_HEAD_COVER_ENTRY.x.toFixed(1)} ${LEFT_HEAD_COVER_ENTRY.y.toFixed(1)}`,
    `L ${leftGuideToCover.x.toFixed(1)} ${leftGuideToCover.y.toFixed(1)}`,
    `M ${RIGHT_HEAD_COVER_EXIT.x.toFixed(1)} ${RIGHT_HEAD_COVER_EXIT.y.toFixed(1)}`,
    `L ${rightGuideFromCover.x.toFixed(1)} ${rightGuideFromCover.y.toFixed(1)}`,
    arcSegmentWithSweep(circles[3], rightGuideFromCover, rightGuideToTensioner, 0),
    `L ${rightTensionerBottom.x.toFixed(1)} ${rightTensionerBottom.y.toFixed(1)}`,
    arcSegment(circles[4], rightTensionerBottom, rightTensionerToReel.from),
    `L ${rightTensionerToReel.to.x.toFixed(1)} ${rightTensionerToReel.to.y.toFixed(1)}`,
  ].join(" ");
}

function angularDegreesPerSecond(linearIps, diameterIn) {
  return (linearIps / (Math.PI * diameterIn)) * 360;
}

function renderCounter(seconds) {
  return Array.from(formatTime(seconds), (character) => {
    if (character === ":") {
      return `<span class="seg-colon"></span>`;
    }
    const on = SEGMENTS[character] || "";
    return `
      <span class="seg-digit" data-on="${on}">
        <span class="a"></span><span class="b"></span><span class="c"></span>
        <span class="d"></span><span class="e"></span><span class="f"></span>
        <span class="g"></span>
      </span>
    `;
  }).join("");
}

class PhilipsN4520PlayerCard extends HTMLElement {
  static getStubConfig(hass) {
    const mediaEntity = Object.keys(hass?.states || {}).find((entityId) => {
      return entityId.startsWith("media_player.");
    });
    return { entity: mediaEntity || "media_player.example", fake_vu: true };
  }

  static getConfigForm() {
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "media_player" } } },
        { name: "name", selector: { text: {} } },
        { name: "ma_server_url", selector: { text: {} } },
        { name: "sendspin_enabled", selector: { boolean: {} } },
        { name: "sendspin_url", selector: { text: {} } },
        { name: "sendspin_auth_token", selector: { text: {} } },
        { name: "sendspin_player_id", selector: { text: {} } },
        { name: "sendspin_client_name", selector: { text: {} } },
        { name: "fake_vu", selector: { boolean: {} } },
        { name: "left_level_entity", selector: { entity: {} } },
        { name: "right_level_entity", selector: { entity: {} } },
      ],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._stateObj = null;
    this._els = {};
    this._raf = 0;
    this._lastFrame = 0;
    this._lastSync = 0;
    this._lastMeter = 0;
    this._levelL = -60;
    this._levelR = -60;
    this._sendspinLevelL = -60;
    this._sendspinLevelR = -60;
    this._sendspinLastAt = 0;
    this._sendspinStatus = "disabled";
    this._sendspinCore = null;
    this._sendspinSocket = null;
    this._sendspinConnectPromise = null;
    this._sendspinKey = "";
    this._sendspinGeneration = 0;
    this._lastCounter = "";
    this._lastSticker = "";
    this._lastTapePath = "";
    this._lastMotionKey = "";
    this._isVisible = true;
    this._visibilityObserver = null;
    this._transportIntent = null;
    this._reelAngles = { left: 0, right: 0 };
    this._reelAnimations = {
      left: { animation: null, sign: 0, duration: 0, baseAngle: 0 },
      right: { animation: null, sign: 0, duration: 0, baseAngle: 0 },
    };
  }

  connectedCallback() {
    this._observeVisibility();
    this._ensureSendspin();
    this._startLoop();
  }

  disconnectedCallback() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this._stopReelAnimation("left");
    this._stopReelAnimation("right");
    this._visibilityObserver?.disconnect();
    this._visibilityObserver = null;
    this._disconnectSendspin("user_request");
  }

  setConfig(config) {
    if (!config?.entity) {
      throw new Error("entity is required");
    }
    this._config = { fake_vu: true, ...config };
    this._renderShell();
    this._ensureSendspin();
    this._syncState();
    this._startLoop();
  }

  set hass(hass) {
    this._hass = hass;
    this._stateObj = hass?.states?.[this._config?.entity] || null;
    this._ensureSendspin();
    this._syncState();
    this._startLoop();
  }

  getCardSize() {
    return 8;
  }

  getGridOptions() {
    return {
      columns: 12,
      rows: 8,
      min_columns: 9,
      min_rows: 6,
    };
  }

  _startLoop() {
    if (this._raf || !this.isConnected || !this._isVisible) return;
    this._lastFrame = performance.now();
    this._lastMeter = this._lastMeter || this._lastFrame;
    this._raf = requestAnimationFrame((now) => this._tick(now));
  }

  _observeVisibility() {
    if (this._visibilityObserver || !("IntersectionObserver" in window)) return;
    this._visibilityObserver = new IntersectionObserver(([entry]) => {
      this._isVisible = Boolean(entry?.isIntersecting);
      if (this._isVisible) {
        this._startLoop();
      } else if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    });
    this._visibilityObserver.observe(this);
  }

  _callService(service, data = {}) {
    if (!this._hass || !this._config?.entity) return;
    this._hass.callService("media_player", service, {
      entity_id: this._config.entity,
      ...data,
    });
  }

  _sendspinConfigKey() {
    if (!this._config?.sendspin_enabled) return "";
    return [
      deriveSendspinUrl(this._config),
      sendspinPlayerId(this._config),
      this._config.sendspin_client_name || "",
      this._config.sendspin_auth_token ? "token" : "",
      this._config.sendspin_library_url || DEFAULT_SENDSPIN_LIBRARY,
    ].join("|");
  }

  _ensureSendspin() {
    if (!this._config || !this.isConnected) return;
    const key = this._sendspinConfigKey();
    if (!key) {
      this._disconnectSendspin("user_request");
      this._sendspinStatus = "disabled";
      return;
    }
    if (key === this._sendspinKey && (this._sendspinCore || this._sendspinConnectPromise)) return;
    this._disconnectSendspin("restart");
    this._sendspinKey = key;
    const generation = this._sendspinGeneration;
    this._sendspinConnectPromise = this._connectSendspin(generation)
      .catch((error) => {
        console.warn("Philips N4520: Sendspin connection failed", error);
        this._sendspinStatus = "error";
      })
      .finally(() => {
        this._sendspinConnectPromise = null;
        this._syncState();
      });
  }

  async _connectSendspin(generation) {
    const sendspinUrl = deriveSendspinUrl(this._config);
    if (!sendspinUrl) {
      this._sendspinStatus = "missing URL";
      return;
    }

    this._sendspinStatus = "connecting";
    this._syncState();
    const socket = await this._openSendspinSocket(sendspinUrl);
    if (generation !== this._sendspinGeneration) {
      socket.close();
      return;
    }
    if (this._sendspinSocket && this._sendspinSocket !== socket) {
      socket.close();
      return;
    }
    this._sendspinSocket = socket;

    const libraryUrl = this._config.sendspin_library_url || DEFAULT_SENDSPIN_LIBRARY;
    const { SendspinCore } = await import(libraryUrl);
    if (generation !== this._sendspinGeneration) {
      socket.close();
      return;
    }
    const core = new SendspinCore({
      playerId: sendspinPlayerId(this._config),
      clientName: this._config.sendspin_client_name || "Philips N4520 Visualizer",
      webSocket: socket,
      codecs: ["pcm", "flac"],
      bufferCapacity: 3 * 1024 * 1024,
      requiredLeadTimeMs: 250,
      minBufferMs: 2500,
    });

    core.onAudioData = (chunk) => this._handleSendspinAudio(chunk);
    core.onConnectionOpen = () => {
      this._sendspinStatus = "connected";
      this._syncState();
    };
    core.onConnectionClose = () => {
      if (this._sendspinCore === core) {
        this._sendspinStatus = "closed";
        this._sendspinCore = null;
        this._sendspinSocket = null;
        this._syncState();
      }
    };
    this._sendspinCore = core;
    await core.connect();
  }

  _openSendspinSocket(url) {
    return new Promise((resolve, reject) => {
      let socket;
      let settled = false;
      let timeout = 0;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(error);
        return;
      }

      socket.binaryType = "arraybuffer";
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        callback(value);
      };

      timeout = window.setTimeout(() => {
        try {
          socket.close();
        } catch {
          // Ignore close failures on timeout cleanup.
        }
        finish(reject, new Error("Sendspin connection timed out"));
      }, 10000);

      socket.onopen = () => {
        if (this._config?.sendspin_auth_token) {
          socket.send(JSON.stringify({
            type: "auth",
            token: this._config.sendspin_auth_token,
            client_id: sendspinPlayerId(this._config),
          }));
          return;
        }
        finish(resolve, socket);
      };

      socket.onmessage = () => {
        if (this._config?.sendspin_auth_token) {
          finish(resolve, socket);
        }
      };

      socket.onerror = () => finish(reject, new Error("Sendspin WebSocket error"));
      socket.onclose = () => {
        if (!settled) finish(reject, new Error("Sendspin WebSocket closed before ready"));
      };
    });
  }

  _disconnectSendspin(reason = "restart") {
    this._sendspinKey = "";
    this._sendspinGeneration += 1;
    if (this._sendspinCore) {
      try {
        this._sendspinCore.disconnect(reason);
      } catch {
        // Ignore disconnect failures.
      }
    } else if (this._sendspinSocket) {
      try {
        this._sendspinSocket.close();
      } catch {
        // Ignore disconnect failures.
      }
    }
    this._sendspinCore = null;
    this._sendspinSocket = null;
    this._sendspinConnectPromise = null;
    this._sendspinLevelL = -60;
    this._sendspinLevelR = -60;
    this._sendspinLastAt = 0;
  }

  _handleSendspinAudio(chunk) {
    const channels = chunk?.samples || [];
    const left = channels[0];
    const right = channels[1] || channels[0];
    this._sendspinLevelL = samplesToDb(left);
    this._sendspinLevelR = samplesToDb(right);
    this._sendspinLastAt = performance.now();
    this._sendspinStatus = "receiving audio";
    this._startLoop();
  }

  _transport(service, intent = null, data = {}) {
    this._transportIntent = intent;
    this._callService(service, data);
    this._syncState();
  }

  _togglePause() {
    const mode = this._mode();
    this._transport("media_play_pause", mode === "pause" || mode === "stop" ? "play" : "pause");
  }

  _levelFromEntity(entityId) {
    if (!entityId || !this._hass?.states?.[entityId]) return null;
    const value = Number(this._hass.states[entityId].state);
    return Number.isFinite(value) ? value : null;
  }

  _mode() {
    const state = this._stateObj?.state;
    if (state === MEDIA_STATE_PLAYING) {
      if (this._transportIntent === "stop" || this._transportIntent === "pause") {
        return this._transportIntent;
      }
      this._transportIntent = null;
      return "play";
    }
    if (state === MEDIA_STATE_PAUSED) {
      if (this._transportIntent === "play") {
        return "play";
      }
      return this._transportIntent === "stop" ? "stop" : "pause";
    }
    this._transportIntent = null;
    return "stop";
  }

  _mediaDetails() {
    const attrs = this._stateObj?.attributes || {};
    return {
      state: this._stateObj?.state || "unavailable",
      title: attrs.media_title || "No media",
      artist: attrs.media_artist || attrs.media_album_artist || "",
      album: attrs.media_album_name || "",
      duration: Number(attrs.media_duration) || 0,
      position: correctedPosition(this._stateObj),
      name: this._config?.name || attrs.friendly_name || "Philips N4520",
      volume: Number(attrs.volume_level),
    };
  }

  _syncState() {
    if (!this.shadowRoot || !this._config || !this._els.deck) return;
    const details = this._mediaDetails();
    const mode = this._mode();
    const position = clamp(details.position, 0, details.duration || Number.MAX_SAFE_INTEGER);
    const progress = details.duration > 0 ? clamp(position / details.duration, 0, 1) : 0;
    const visualProgress = Math.round(progress * 200) / 200;
    const sticker = [details.artist, details.title, details.album].filter(Boolean).join("\n");

    this._els.deck.dataset.mode = mode;
    this._els.name.textContent = details.name;
    this._els.state.textContent = details.state;
    this._els.title.textContent = details.title;
    this._els.artist.textContent = details.artist;
    this._els.album.textContent = details.album;
    this._els.source.textContent = this._levelsConfigured()
      ? "VU levels: configured external level source"
      : this._sendspinSourceText();
    this._els.progress.style.width = `${(progress * 100).toFixed(2)}%`;
    this._els.position.textContent = formatTime(position);
    this._els.duration.textContent = details.duration > 0 ? formatTime(details.duration) : "--:--";
    this._els.leftPack.style.setProperty("--pack", `${tapePackPercent(visualProgress, "left").toFixed(2)}%`);
    this._els.rightPack.style.setProperty("--pack", `${tapePackPercent(visualProgress, "right").toFixed(2)}%`);
    this._applyMotionSpeeds(visualProgress, mode === "play");
    this._updateTapePath(visualProgress, mode === "play");

    if (sticker !== this._lastSticker) {
      this._lastSticker = sticker;
      this._els.sticker.innerHTML = `
        <strong>${htmlEscape(details.artist || "Unknown artist")}</strong>
        <span>${htmlEscape(details.title || "Untitled")}</span>
        <small>${htmlEscape(details.album || "Unknown album")}</small>
      `;
    }

    const counterText = renderCounter(position);
    if (counterText !== this._lastCounter) {
      this._lastCounter = counterText;
      this._els.counter.innerHTML = counterText;
    }
  }

  _levelsConfigured() {
    return Boolean(this._config?.left_level_entity && this._config?.right_level_entity);
  }

  _sendspinLevelsActive() {
    return this._config?.sendspin_enabled
      && performance.now() - this._sendspinLastAt < 1500;
  }

  _sendspinSourceText() {
    if (this._sendspinLevelsActive()) return "VU levels: Music Assistant Sendspin";
    if (this._config?.sendspin_enabled) return `VU levels: Sendspin ${this._sendspinStatus}`;
    return "VU levels: fake fallback until Music Assistant levels are configured";
  }

  _currentReelAnimationAngle(side) {
    const state = this._reelAnimations[side];
    if (!state?.animation || !Number.isFinite(state.duration) || state.duration <= 0) {
      return this._reelAngles[side];
    }
    const currentTime = Number(state.animation.currentTime);
    if (!Number.isFinite(currentTime)) return this._reelAngles[side];
    const progress = (((currentTime % state.duration) + state.duration) % state.duration) / state.duration;
    return state.baseAngle + state.sign * progress * 360;
  }

  _stopReelAnimation(side) {
    const state = this._reelAnimations[side];
    const element = side === "left" ? this._els.leftReel : this._els.rightReel;
    if (!state || !element) return;
    const angle = this._currentReelAnimationAngle(side);
    state.animation?.cancel();
    state.animation = null;
    state.sign = 0;
    state.duration = 0;
    state.baseAngle = angle;
    this._reelAngles[side] = angle;
    element.style.transform = `rotate(${angle.toFixed(3)}deg)`;
  }

  _setReelAnimationSpeed(side, element, desiredDps) {
    if (!element?.animate) return;
    const state = this._reelAnimations[side];
    if (Math.abs(desiredDps) < 0.001 || this._mode() !== "play") {
      this._stopReelAnimation(side);
      return;
    }

    const sign = Math.sign(desiredDps);
    const duration = Math.max(80, (360 / Math.abs(desiredDps)) * 1000);
    const relativeChange = Math.abs(state.duration - duration) / Math.max(duration, state.duration, 1);
    const shouldRecreate = !state.animation
      || state.sign !== sign
      || (Math.abs(state.duration - duration) > REEL_ANIMATION_DURATION_THRESHOLD_MS && relativeChange > 0.025);

    if (shouldRecreate) {
      const baseAngle = this._currentReelAnimationAngle(side);
      state.animation?.cancel();
      element.style.transform = "";
      state.animation = element.animate(
        [
          { transform: `rotate(${baseAngle.toFixed(3)}deg)` },
          { transform: `rotate(${(baseAngle + sign * 360).toFixed(3)}deg)` },
        ],
        {
          duration,
          iterations: Infinity,
          easing: "linear",
        },
      );
      state.sign = sign;
      state.duration = duration;
      state.baseAngle = baseAngle;
      this._reelAngles[side] = baseAngle;
    } else if (state.animation.playState !== "running") {
      state.animation.play();
    }
  }

  _applyMotionSpeeds(progress, playing) {
    if (!this._els.deck) return;
    if (!playing) {
      this._lastMotionKey = "stopped";
      this._stopReelAnimation("left");
      this._stopReelAnimation("right");
      return;
    }

    const tapeSpeed = SLOWEST_SPEED_IPS;
    const leftDps = angularDegreesPerSecond(tapeSpeed, tapePackDiameter(progress, "left"));
    const rightDps = angularDegreesPerSecond(tapeSpeed, tapePackDiameter(progress, "right"));
    const pinchDps = angularDegreesPerSecond(tapeSpeed, PINCH_ROLLER_DIAMETER_IN);
    const guideDps = angularDegreesPerSecond(tapeSpeed, GUIDE_ROLLER_DIAMETER_IN);
    const tensionerDps = angularDegreesPerSecond(tapeSpeed, TENSIONER_ROLLER_DIAMETER_IN);
    const durations = {
      pinch: (360 / Math.max(1, pinchDps)).toFixed(3),
      guide: (360 / Math.max(1, guideDps)).toFixed(3),
      tensioner: (360 / Math.max(1, tensionerDps)).toFixed(3),
    };
    this._setReelAnimationSpeed("left", this._els.leftReel, -leftDps);
    this._setReelAnimationSpeed("right", this._els.rightReel, -rightDps);
    const key = Object.values(durations).join("|");
    if (key === this._lastMotionKey) return;
    this._lastMotionKey = key;
    this._els.deck.style.setProperty("--pinch-duration", `${durations.pinch}s`);
    this._els.deck.style.setProperty("--guide-duration", `${durations.guide}s`);
    this._els.deck.style.setProperty("--tensioner-duration", `${durations.tensioner}s`);
  }

  _updateTapePath(progress, playing) {
    const path = tapePath(progress, playing);
    if (!path || path === this._lastTapePath) return;
    this._lastTapePath = path;
    this._els.tapeShadow.setAttribute("d", path);
    this._els.tapeLine.setAttribute("d", path);
  }

  _targetLevels(nowSeconds) {
    const externalL = this._levelFromEntity(this._config.left_level_entity);
    const externalR = this._levelFromEntity(this._config.right_level_entity);
    if (externalL !== null && externalR !== null) {
      return [externalL, externalR];
    }

    if (this._sendspinLevelsActive()) {
      return [this._sendspinLevelL, this._sendspinLevelR];
    }

    if (!this._config.fake_vu || this._mode() !== "play") {
      return [-60, -60];
    }

    const details = this._mediaDetails();
    const seed = hashString(`${details.artist}|${details.title}|${details.album}`);
    const a = ((seed & 255) / 255) * Math.PI * 2;
    const b = (((seed >> 8) & 255) / 255) * Math.PI * 2;
    const volumeOffset = Number.isFinite(details.volume) ? (details.volume - 0.65) * 5 : 0;
    const pulse = Math.sin(nowSeconds * 2.7 + a) * 5.8;
    const body = Math.sin(nowSeconds * 7.3 + b) * 2.3;
    const transient = Math.max(0, Math.sin(nowSeconds * 11.9 + a * 0.7)) ** 8 * 9.5;
    const base = -9.5 + volumeOffset + pulse + body + transient;
    return [
      clamp(base + Math.sin(nowSeconds * 5.1 + b) * 1.8, -19, 5.5),
      clamp(base + Math.sin(nowSeconds * 4.6 + a) * 2.1 - 1.1, -19, 5.5),
    ];
  }

  _tick(now) {
    this._raf = 0;
    this._lastFrame = now;

    if (now - this._lastSync >= 500) {
      this._lastSync = now;
      this._syncState();
    }

    if (now - this._lastMeter < 33) {
      this._scheduleNextFrame();
      return;
    }

    const meterDt = clamp((now - this._lastMeter) / 1000, 1 / 60, 0.12);
    this._lastMeter = now;
    const playing = this._mode() === "play";
    const nowSeconds = now / 1000;
    const [targetL, targetR] = this._targetLevels(nowSeconds);
    const response = playing || this._levelsConfigured() || this._sendspinLevelsActive() ? 4.8 : 3.2;

    this._levelL += (targetL - this._levelL) * Math.min(1, meterDt * response);
    this._levelR += (targetR - this._levelR) * Math.min(1, meterDt * response);

    const needleL = meterAngle(this._levelL);
    const needleR = meterAngle(this._levelR);
    this._els.needleL.style.setProperty("--angle", `${needleL.toFixed(2)}deg`);
    this._els.needleR.style.setProperty("--angle", `${needleR.toFixed(2)}deg`);
    this._els.needleShadowL.style.setProperty("--angle", `${needleL.toFixed(2)}deg`);
    this._els.needleShadowR.style.setProperty("--angle", `${needleR.toFixed(2)}deg`);
    this._els.ledL3.classList.toggle("on", needleL >= 16.4);
    this._els.ledR3.classList.toggle("on", needleR >= 16.4);
    this._els.ledL6.classList.toggle("on", this._levelL >= 5.7);
    this._els.ledR6.classList.toggle("on", this._levelR >= 5.7);

    this._scheduleNextFrame();
  }

  _scheduleNextFrame() {
    if (!this._isVisible) return;
    const levelsActive = Math.abs(this._levelL - -60) > 0.1 || Math.abs(this._levelR - -60) > 0.1;
    if (this._mode() === "play" || levelsActive || this._levelsConfigured() || this._config?.sendspin_enabled) {
      this._raf = requestAnimationFrame((nextNow) => this._tick(nextNow));
    }
  }

  _renderShell() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          color: var(--primary-text-color, #f2eee5);
        }

        * {
          box-sizing: border-box;
        }

        ha-card {
          overflow: hidden;
          background: #101111;
          color: var(--primary-text-color, #f2eee5);
        }

        .card {
          padding: 10px;
        }

        .deck-photo-stage {
          position: relative;
          width: 100%;
          aspect-ratio: 4 / 3;
          overflow: hidden;
          border-radius: 7px;
          background: #111;
          box-shadow:
            0 22px 70px rgba(0, 0, 0, 0.48),
            0 2px 0 rgba(255, 255, 255, 0.08) inset,
            0 0 0 1px rgba(255, 255, 255, 0.12);
        }

        .deck-photo {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          user-select: none;
          pointer-events: none;
        }

        .photo-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 50% 43%, transparent 48%, rgba(0, 0, 0, 0.24) 83%, rgba(0, 0, 0, 0.5) 100%),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.04), transparent 28%, rgba(0, 0, 0, 0.1));
          mix-blend-mode: multiply;
        }

        .transport-photo {
          position: absolute;
          pointer-events: none;
          user-select: none;
          will-change: left, top, transform;
        }

        .reel-mount {
          position: absolute;
          width: 36.75%;
          aspect-ratio: 1;
          border-radius: 50%;
          z-index: 4;
        }

        .reel-mount-left {
          left: 31.94%;
          top: 29.08%;
          transform: translate(-50%, -50%);
        }

        .reel-mount-right {
          left: 67.56%;
          top: 29.25%;
          transform: translate(-50%, -50%);
        }

        .photo-reel {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          overflow: hidden;
          transform-origin: 50% 50%;
          will-change: transform;
          background: transparent;
        }

        .photo-reel::before {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 2;
          border-radius: inherit;
          background: center / contain no-repeat url("${ASSETS.reel}");
          pointer-events: none;
        }

        .photo-pack {
          --pack: 52%;
          position: absolute;
          z-index: 1;
          left: 50%;
          top: 50%;
          width: var(--pack);
          aspect-ratio: 1;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          background:
            repeating-radial-gradient(circle, rgba(92, 50, 34, 0.96) 0 1px, rgba(51, 28, 22, 0.98) 1px 3px),
            radial-gradient(circle, #5b321f, #23130e 72%);
          box-shadow:
            0 0 22px rgba(0, 0, 0, 0.5) inset,
            0 0 0 1px rgba(255, 255, 255, 0.07);
          opacity: 0.96;
        }

        .reel-sticker {
          position: absolute;
          z-index: 3;
          left: calc(31% + 20px);
          top: 74%;
          width: 38%;
          min-height: 11%;
          padding: 2.6% 3.2%;
          border-radius: 4px 6px 5px 3px;
          transform-origin: 50% 50%;
          transform: translate(-50%, -50%) rotate(33deg);
          background:
            linear-gradient(90deg, rgba(204, 68, 54, 0.18) 0 9%, transparent 9%),
            repeating-linear-gradient(180deg, transparent 0 1.34em, rgba(69, 116, 170, 0.26) 1.34em calc(1.34em + 1px), transparent calc(1.34em + 1px) 1.62em),
            linear-gradient(94deg, rgba(255,255,255,0.62), transparent 32%),
            linear-gradient(#f5f0df, #ebe3cf);
          color: #2d2117;
          font-family: "Segoe Print", "Bradley Hand ITC", "Bradley Hand", "Marker Felt", "Comic Sans MS", "Comic Sans", "Chalkboard SE", "Noteworthy", cursive;
          font-size: clamp(5px, 0.78vw, 13px);
          line-height: 1.04;
          letter-spacing: 0;
          border: 1px solid rgba(98, 83, 58, 0.5);
          box-shadow:
            0 1px 1px rgba(255, 255, 255, 0.45) inset,
            0 2px 4px rgba(0, 0, 0, 0.24);
          display: grid;
          align-content: center;
          gap: 0.08em;
          text-align: left;
          pointer-events: none;
        }

        .reel-sticker strong,
        .reel-sticker span,
        .reel-sticker small {
          display: block;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .reel-sticker strong {
          font-size: 1.02em;
          font-weight: 700;
        }

        .reel-sticker small {
          font-size: 0.82em;
        }

        .photo-tape-path {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 3;
        }

        .tape-shadow,
        .tape-line {
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .tape-shadow {
          stroke: rgba(32, 14, 8, 0.72);
          stroke-width: 4.6;
          opacity: 0.24;
        }

        .tape-line {
          stroke: #3b2114;
          stroke-width: 3.2;
          filter: drop-shadow(0 1px 1px rgba(27, 12, 6, 0.36));
        }

        .pinch-roller-photo {
          --pinch-rot: 0deg;
          --pinch-clip-left: 0%;
          --pinch-clip-right: 0%;
          left: 57.1%;
          top: 67.4%;
          width: 5.35%;
          aspect-ratio: 1;
          z-index: 5;
          filter: drop-shadow(0 4px 5px rgba(0, 0, 0, 0.46));
          clip-path: polygon(100% var(--pinch-clip-right), 100% 100%, 0 100%, 0 var(--pinch-clip-left));
          transform: translate(-50%, -50%);
          transition: top 180ms ease, clip-path 180ms ease;
        }

        .deck-photo-stage[data-mode="play"] .pinch-roller-photo {
          top: 65.6%;
          --pinch-clip-left: 62%;
          --pinch-clip-right: 24%;
        }

        .pinch-roller-body,
        .pinch-roller-face,
        .tensioner-body,
        .tensioner-face,
        .guide-roller-body,
        .guide-roller-face {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .pinch-roller-face {
          clip-path: circle(35% at 48.5% 48%);
          opacity: 0.22;
          transform-origin: 48.5% 48%;
          animation: roller-spin-cw var(--pinch-duration, 0.28s) linear infinite;
          animation-play-state: paused;
        }

        .deck-photo-stage[data-mode="play"] .pinch-roller-face {
          animation-play-state: running;
        }

        .head-assembly-occluder {
          display: none;
        }

        .tensioner-photo {
          --tensioner-rot: 0deg;
          left: 0;
          top: 0;
          width: 5.3%;
          aspect-ratio: 1;
          z-index: 5;
          filter: drop-shadow(0 5px 7px rgba(0, 0, 0, 0.42));
          transition: left 180ms ease, top 180ms ease;
        }

        .tensioner-photo-left {
          left: 25.1%;
          top: 63.6%;
          transform: translate(-50%, -50%) scale(0.75);
        }

        .tensioner-photo-right {
          left: 74.9%;
          top: 63.6%;
          transform: translate(-50%, -50%) scale(-0.75, 0.75);
        }

        .deck-photo-stage[data-mode="play"] .tensioner-photo-left {
          left: 24.55%;
          top: 60.1%;
        }

        .deck-photo-stage[data-mode="play"] .tensioner-photo-right {
          left: 75.45%;
          top: 60.1%;
        }

        .tensioner-face {
          clip-path: circle(31% at 48% 58%);
          opacity: 0.22;
          transform-origin: 48% 58%;
          animation: roller-spin-ccw var(--tensioner-duration, 0.24s) linear infinite;
          animation-play-state: paused;
        }

        .tensioner-photo-right .tensioner-face {
          animation-name: roller-spin-cw;
        }

        .deck-photo-stage[data-mode="play"] .tensioner-face {
          animation-play-state: running;
        }

        .guide-roller-photo {
          --guide-rot: 0deg;
          width: 7.95%;
          aspect-ratio: 180 / 177;
          z-index: 5;
          filter: drop-shadow(0 5px 7px rgba(0, 0, 0, 0.42));
        }

        .guide-roller-photo-left {
          left: 32.42%;
          top: 60.5%;
          transform: translate(-50%, -50%);
        }

        .guide-roller-photo-right {
          left: 67.58%;
          top: 60.5%;
          transform: translate(-50%, -50%) scaleX(-1);
        }

        .guide-roller-face {
          clip-path: circle(35% at 40% 58%);
          opacity: 0.22;
          transform-origin: 40% 58%;
          animation: roller-spin-cw var(--guide-duration, 0.36s) linear infinite;
          animation-play-state: paused;
        }

        .guide-roller-photo-right .guide-roller-face {
          animation-name: roller-spin-ccw;
        }

        .deck-photo-stage[data-mode="play"] .guide-roller-face {
          animation-play-state: running;
        }

        .vu-window {
          position: absolute;
          overflow: hidden;
          pointer-events: none;
          z-index: 5;
          border-radius: 2px;
        }

        .vu-window-left {
          --pivot-x: 51.6%;
          left: 39.92%;
          top: 75.14%;
          width: 8.43%;
          height: 7.27%;
        }

        .vu-window-right {
          --pivot-x: 51.6%;
          left: 51.04%;
          top: 75.14%;
          width: 8.49%;
          height: 7.27%;
        }

        .vu-needle,
        .vu-needle-shadow {
          --angle: -35deg;
          position: absolute;
          left: var(--pivot-x);
          bottom: -27.85%;
          width: 0.85px;
          height: 97%;
          border-radius: 999px;
          transform-origin: 50% 100%;
          pointer-events: none;
        }

        .vu-needle {
          transform: translateX(-50%) rotate(var(--angle));
          background: linear-gradient(to top, #17100d 0%, #2a1d17 72%, #17100d 100%);
          box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.22);
        }

        .vu-needle-shadow {
          width: 0.75px;
          opacity: 0.1;
          background: rgba(45, 24, 14, 0.62);
          transform: translate(-50%, -4px) rotate(var(--angle));
          filter: blur(0.7px);
        }

        .meter-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 6;
        }

        .led {
          --led-size: clamp(3px, 0.36%, 5px);
          position: absolute;
          width: var(--led-size);
          height: var(--led-size);
          border-radius: 50%;
          display: grid;
          place-items: center;
          transform: translate(-50%, -50%);
          color: transparent;
          background: #211511;
          box-shadow:
            0 0 0 1px rgba(0, 0, 0, 0.7) inset,
            0 1px 2px rgba(0, 0, 0, 0.55);
        }

        .led.l3.on {
          background: radial-gradient(circle, #fff8b4 0 16%, #e6bc32 48%, #5b3d0c 86%);
          box-shadow: 0 0 7px rgba(255, 218, 69, 0.95), 0 0 13px rgba(223, 171, 34, 0.54);
        }

        .led.l6.on {
          background: radial-gradient(circle, #ffd5c8 0 14%, #e2361b 48%, #601009 88%);
          box-shadow: 0 0 7px rgba(255, 69, 39, 0.92), 0 0 13px rgba(236, 43, 24, 0.56);
        }

        .led-l3 { left: 43.40%; top: 83.30%; }
        .led-l6 { left: 45.23%; top: 83.33%; }
        .led-r3 { left: 54.72%; top: 83.30%; }
        .led-r6 { left: 56.60%; top: 83.33%; }

        .hotspot {
          position: absolute;
          appearance: none;
          border: 0;
          padding: 0;
          background: transparent;
          border-radius: 3px;
          cursor: pointer;
          z-index: 7;
        }

        .hotspot::after {
          content: "";
          position: absolute;
          inset: -45%;
          border-radius: 8px;
          opacity: 0;
          background: radial-gradient(circle, rgba(112, 210, 255, 0.42), transparent 68%);
          transition: opacity 140ms ease;
        }

        .hotspot:hover::after,
        .hotspot:focus-visible::after {
          opacity: 1;
        }

        .transport-hotspot {
          width: 2.0%;
          height: 1.15%;
        }

        .transport-hotspot.rewind { left: 68.06%; top: 70.40%; }
        .transport-hotspot.ff { left: 71.03%; top: 70.40%; }
        .transport-hotspot.play { left: 73.72%; top: 70.40%; }
        .transport-hotspot.stop { left: 76.84%; top: 70.40%; }
        .transport-hotspot.pause { left: 76.84%; top: 66.65%; }

        .pause-indicator {
          position: absolute;
          left: 75.47%;
          top: 67.44%;
          width: clamp(4px, 0.46vw, 7px);
          aspect-ratio: 1;
          border-radius: 50%;
          z-index: 5;
          background: rgba(53, 7, 4, 0.56);
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.62) inset;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }

        .deck-photo-stage[data-mode="pause"] .pause-indicator {
          background: radial-gradient(circle, #ffc6bc 0 10%, #e43320 44%, #5b0c07 88%);
          box-shadow: 0 0 8px rgba(255, 60, 39, 0.86), 0 0 14px rgba(255, 59, 35, 0.42);
        }

        .counter-overlay {
          position: absolute;
          left: 27.42%;
          top: 68.23%;
          width: 9.74%;
          height: 3.13%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: min(0.22vw, 3px);
          pointer-events: none;
          z-index: 4;
        }

        .seg-digit {
          --seg-on: rgba(35, 255, 87, 0.92);
          --seg-off: rgba(35, 255, 87, 0.08);
          position: relative;
          width: min(0.86vw, 12px);
          aspect-ratio: 0.58;
          filter: drop-shadow(0 0 5px rgba(38, 255, 91, 0.68));
        }

        .seg-digit span {
          position: absolute;
          display: block;
          background: var(--seg-off);
          border-radius: 999px;
        }

        .seg-digit .a,
        .seg-digit .d,
        .seg-digit .g {
          left: 18%;
          width: 64%;
          height: 8%;
        }

        .seg-digit .a { top: 4%; }
        .seg-digit .g { top: 46%; }
        .seg-digit .d { bottom: 4%; }
        .seg-digit .b,
        .seg-digit .c,
        .seg-digit .e,
        .seg-digit .f {
          width: 9%;
          height: 38%;
        }
        .seg-digit .b,
        .seg-digit .c { right: 5%; }
        .seg-digit .e,
        .seg-digit .f { left: 5%; }
        .seg-digit .b,
        .seg-digit .f { top: 9%; }
        .seg-digit .c,
        .seg-digit .e { bottom: 9%; }
        .seg-digit[data-on~="a"] .a,
        .seg-digit[data-on~="b"] .b,
        .seg-digit[data-on~="c"] .c,
        .seg-digit[data-on~="d"] .d,
        .seg-digit[data-on~="e"] .e,
        .seg-digit[data-on~="f"] .f,
        .seg-digit[data-on~="g"] .g {
          background: var(--seg-on);
        }

        .seg-colon {
          width: min(0.24vw, 3px);
          height: min(1.1vw, 16px);
          position: relative;
          filter: drop-shadow(0 0 5px rgba(38, 255, 91, 0.72));
        }

        .seg-colon::before,
        .seg-colon::after {
          content: "";
          position: absolute;
          left: 50%;
          width: min(0.2vw, 3px);
          aspect-ratio: 1;
          border-radius: 50%;
          transform: translateX(-50%);
          background: rgba(35, 255, 87, 0.88);
        }

        .seg-colon::before { top: 25%; }
        .seg-colon::after { bottom: 25%; }

        .readout {
          display: grid;
          gap: 8px;
          padding: 10px 4px 2px;
        }

        .header,
        .progress {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 8px;
        }

        .name {
          font-size: 14px;
          font-weight: 650;
        }

        .state,
        .source,
        .artist,
        .album,
        .time {
          color: var(--secondary-text-color, #b8b1a6);
          font-size: 12px;
        }

        .state {
          text-transform: uppercase;
        }

        .title {
          font-size: 15px;
          line-height: 1.22;
          font-weight: 700;
        }

        .artist,
        .album {
          line-height: 1.2;
        }

        .bar {
          height: 5px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          overflow: hidden;
        }

        .bar span {
          display: block;
          height: 100%;
          width: 0%;
          background: #d7a448;
        }

        @keyframes roller-spin-cw {
          to { transform: rotate(360deg); }
        }

        @keyframes roller-spin-ccw {
          to { transform: rotate(-360deg); }
        }
      </style>
      <ha-card>
        <div class="card">
          <div class="deck-photo-stage" data-mode="stop">
            <img class="deck-photo" src="${ASSETS.deck}" alt="Philips N4520 reel to reel deck">
            <div class="photo-vignette" aria-hidden="true"></div>

            <div class="transport-photo tensioner-photo tensioner-photo-left" aria-hidden="true">
              <img class="tensioner-body" src="${ASSETS.tensioner}" alt="">
              <img class="tensioner-face" src="${ASSETS.tensioner}" alt="">
            </div>
            <div class="transport-photo tensioner-photo tensioner-photo-right" aria-hidden="true">
              <img class="tensioner-body" src="${ASSETS.tensioner}" alt="">
              <img class="tensioner-face" src="${ASSETS.tensioner}" alt="">
            </div>
            <div class="transport-photo guide-roller-photo guide-roller-photo-left" aria-hidden="true">
              <img class="guide-roller-body" src="${ASSETS.guide}" alt="">
              <img class="guide-roller-face" src="${ASSETS.guide}" alt="">
            </div>
            <div class="transport-photo guide-roller-photo guide-roller-photo-right" aria-hidden="true">
              <img class="guide-roller-body" src="${ASSETS.guide}" alt="">
              <img class="guide-roller-face" src="${ASSETS.guide}" alt="">
            </div>
            <div class="transport-photo pinch-roller-photo" aria-hidden="true">
              <img class="pinch-roller-body" src="${ASSETS.pinch}" alt="">
              <img class="pinch-roller-face" src="${ASSETS.pinch}" alt="">
            </div>
            <div class="head-assembly-occluder" aria-hidden="true"></div>

            <div class="reel-mount reel-mount-left">
              <div class="photo-reel left-reel">
                <div class="tape-pack photo-pack left-pack"></div>
                <div class="reel-sticker"></div>
              </div>
            </div>
            <div class="reel-mount reel-mount-right">
              <div class="photo-reel right-reel">
                <div class="tape-pack photo-pack right-pack"></div>
              </div>
            </div>

            <svg class="photo-tape-path" viewBox="0 0 1600 1200" preserveAspectRatio="none" aria-hidden="true">
              <path class="tape-shadow"></path>
              <path class="tape-line"></path>
            </svg>

            <div class="vu-window vu-window-left" aria-hidden="true">
              <span class="vu-needle-shadow needle-shadow-l"></span>
              <span class="vu-needle needle-l"></span>
            </div>
            <div class="vu-window vu-window-right" aria-hidden="true">
              <span class="vu-needle-shadow needle-shadow-r"></span>
              <span class="vu-needle needle-r"></span>
            </div>

            <div class="meter-overlay" aria-hidden="true">
              <span class="led l3 led-l3"></span>
              <span class="led l6 led-l6"></span>
              <span class="led l3 led-r3"></span>
              <span class="led l6 led-r6"></span>
            </div>

            <button class="hotspot transport-hotspot rewind" aria-label="previous track"></button>
            <button class="hotspot transport-hotspot stop" aria-label="stop"></button>
            <button class="hotspot transport-hotspot play" aria-label="play"></button>
            <button class="hotspot transport-hotspot pause" aria-label="pause"></button>
            <button class="hotspot transport-hotspot ff" aria-label="next track"></button>
            <span class="pause-indicator" aria-hidden="true"></span>
            <div class="counter-overlay" aria-label="elapsed time"></div>
          </div>
          <div class="readout">
            <div class="header">
              <div class="name"></div>
              <div></div>
              <div class="state"></div>
            </div>
            <div>
              <div class="title"></div>
              <div class="artist"></div>
              <div class="album"></div>
            </div>
            <div class="progress">
              <span class="time position">00:00</span>
              <div class="bar"><span></span></div>
              <span class="time duration">--:--</span>
            </div>
            <div class="source"></div>
          </div>
        </div>
      </ha-card>
    `;

    const root = this.shadowRoot;
    this._els = {
      deck: root.querySelector(".deck-photo-stage"),
      leftReel: root.querySelector(".left-reel"),
      rightReel: root.querySelector(".right-reel"),
      leftPack: root.querySelector(".left-pack"),
      rightPack: root.querySelector(".right-pack"),
      sticker: root.querySelector(".reel-sticker"),
      guideL: root.querySelector(".guide-roller-photo-left"),
      guideR: root.querySelector(".guide-roller-photo-right"),
      pinch: root.querySelector(".pinch-roller-photo"),
      tensionL: root.querySelector(".tensioner-photo-left"),
      tensionR: root.querySelector(".tensioner-photo-right"),
      tape: root.querySelector(".photo-tape-path"),
      tapeShadow: root.querySelector(".tape-shadow"),
      tapeLine: root.querySelector(".tape-line"),
      needleL: root.querySelector(".needle-l"),
      needleR: root.querySelector(".needle-r"),
      needleShadowL: root.querySelector(".needle-shadow-l"),
      needleShadowR: root.querySelector(".needle-shadow-r"),
      ledL3: root.querySelector(".led-l3"),
      ledL6: root.querySelector(".led-l6"),
      ledR3: root.querySelector(".led-r3"),
      ledR6: root.querySelector(".led-r6"),
      counter: root.querySelector(".counter-overlay"),
      name: root.querySelector(".name"),
      state: root.querySelector(".state"),
      title: root.querySelector(".title"),
      artist: root.querySelector(".artist"),
      album: root.querySelector(".album"),
      source: root.querySelector(".source"),
      progress: root.querySelector(".bar span"),
      position: root.querySelector(".position"),
      duration: root.querySelector(".duration"),
    };

    root.querySelector(".rewind")?.addEventListener("click", () => this._transport("media_previous_track"));
    root.querySelector(".ff")?.addEventListener("click", () => this._transport("media_next_track"));
    root.querySelector(".play")?.addEventListener("click", () => this._transport("media_play", "play"));
    root.querySelector(".pause")?.addEventListener("click", () => this._togglePause());
    root.querySelector(".stop")?.addEventListener("click", () => this._transport("media_stop", "stop"));
  }
}

if (!customElements.get("philips-n4520-player")) {
  customElements.define("philips-n4520-player", PhilipsN4520PlayerCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "philips-n4520-player",
  name: "Philips N4520 Player",
  description: "Music Assistant aware reel-to-reel player card",
  preview: true,
});

console.info(`%cPHILIPS-N4520-PLAYER ${CARD_VERSION}`, "color: #d7a448; font-weight: 700");
