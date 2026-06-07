import * as THREE from "./assets/three.module.min.js";

const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");
const trackName = document.getElementById("trackName");
const deck = document.getElementById("deck");
const reelCanvas = document.getElementById("reelCanvas");
const leftReel = document.getElementById("leftReel");
const rightReel = document.getElementById("rightReel");
const leftPack = document.getElementById("leftPack");
const rightPack = document.getElementById("rightPack");
const capstan = document.getElementById("capstan");
const counter = document.getElementById("counter");
const movingTape = document.getElementById("movingTape");
const tapeShadow = document.getElementById("tapeShadow");
const pinchRollerPhoto = document.getElementById("pinchRollerPhoto");
const tensionerLeft = document.getElementById("tensionerLeft");
const tensionerRight = document.getElementById("tensionerRight");

const buttons = {
  play: document.getElementById("playButton"),
  stop: document.getElementById("stopButton"),
  pause: document.getElementById("pauseButton"),
  rewind: document.getElementById("rewindButton"),
  ff: document.getElementById("ffButton"),
};

const needles = {
  left: document.getElementById("needleL"),
  right: document.getElementById("needleR"),
  leftShadow: document.getElementById("needleShadowL"),
  rightShadow: document.getElementById("needleShadowR"),
};

const leds = {
  left3: document.getElementById("ledL3"),
  left6: document.getElementById("ledL6"),
  right3: document.getElementById("ledR3"),
  right6: document.getElementById("ledR6"),
};

let audioContext;
let analyser;
let source;
let splitter;
let analyserL;
let analyserR;
let dataL;
let dataR;
let selectedUrl;
let mode = "stop";
let speedIps = 15;
let reelAngleL = 0;
let reelAngleR = 0;
let capstanAngle = 0;
let tapeOffset = 0;
let lastFrame = performance.now();
let zeroOffset = 0;
let levelL = -60;
let levelR = -60;
let windWasPlaying = false;

const reelDiameterIn = 10.5;
const hubDiameterIn = 3.0;
const emptyTapeDiameterIn = hubDiameterIn * 1.2;
const fullTapeDiameterIn = 9.35;
const windingSpeedIps = 90;
const pinchRollerDiameterIn = 1.15;
const meterMinDb = -20;
const meterMaxDb = 6;
const meterRedStartAngle = 16.4;
const windSecondsPerSecond = 12;
const referenceWidth = 1600;
const referenceHeight = 1200;
const reelTextureSize = 560;
const leftReelCenter = { x: 511, y: 349 };
const rightReelCenter = { x: 1081, y: 351 };
const rollerRestCenter = { x: 914, y: 821 };
const rollerPlayCenter = { x: 914, y: 796 };
const leftTensionerRest = { x: 398, y: 752 };
const leftTensionerRun = { x: 391, y: 718 };
const leftTensionerKick = { x: 386, y: 688 };
const rightTensionerRest = { x: 1202, y: 752 };
const rightTensionerRun = { x: 1209, y: 718 };
const rightTensionerKick = { x: 1214, y: 688 };
const vuScale = [
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
  { db: 3, angle: meterRedStartAngle },
  { db: 4, angle: 23.0 },
  { db: 5, angle: 30.0 },
  { db: 6, angle: 36.9 },
];

const reel3d = {
  ready: false,
  renderer: null,
  scene: null,
  camera: null,
  left: null,
  right: null,
  roller: null,
  rollerWheel: null,
  leftPack: null,
  rightPack: null,
};

const pinchRollerState = {
  lift: 0,
  velocity: 0,
};

const tensionerState = {
  lift: 0,
  velocity: 0,
  wasMoving: false,
  wobble: 0,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stageY(y) {
  return referenceHeight - y;
}

function createShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(118, 122, 22, 128, 128, 120);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.34)");
  gradient.addColorStop(0.52, "rgba(0, 0, 0, 0.2)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

function createBrushedMetalTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  const base = ctx.createRadialGradient(cx * 0.72, cy * 0.68, 4, cx, cy, cx * 0.58);
  base.addColorStop(0, "#fbfaf0");
  base.addColorStop(0.18, "#d3d4cf");
  base.addColorStop(0.38, "#8f928e");
  base.addColorStop(0.62, "#f1f1e9");
  base.addColorStop(1, "#8a8c86");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 120; i += 1) {
    ctx.rotate((Math.PI * 2) / 120);
    ctx.strokeStyle = i % 2 === 0 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cx * 0.92, 0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createTapePackTexture(size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;

  const base = ctx.createRadialGradient(cx, cy, 18, cx, cy, cx * 0.98);
  base.addColorStop(0, "#5a3324");
  base.addColorStop(0.45, "#47261b");
  base.addColorStop(1, "#24120d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(219, 151, 92, 0.24)";
  for (let r = 18; r < cx * 0.98; r += 3.2) {
    ctx.lineWidth = r % 9 < 3.2 ? 1.0 : 0.45;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  for (let r = 20; r < cx * 0.98; r += 7.8) {
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createSpindleAssembly() {
  const group = new THREE.Group();
  group.position.z = 22;

  const black = new THREE.MeshStandardMaterial({
    color: 0x090a0a,
    metalness: 0.18,
    roughness: 0.48,
  });
  const darkRubber = new THREE.MeshStandardMaterial({
    color: 0x171918,
    metalness: 0.08,
    roughness: 0.62,
  });
  const metal = new THREE.MeshStandardMaterial({
    map: createBrushedMetalTexture(256),
    metalness: 0.82,
    roughness: 0.23,
  });

  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(78, 82, 18, 96), darkRubber);
  adapter.rotation.x = Math.PI / 2;
  adapter.position.z = 0;
  group.add(adapter);

  const innerCup = new THREE.Mesh(new THREE.CylinderGeometry(54, 60, 18, 96), black);
  innerCup.rotation.x = Math.PI / 2;
  innerCup.position.z = 14;
  group.add(innerCup);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(34, 40, 16, 96), black);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 31;
  group.add(cap);

  const button = new THREE.Mesh(new THREE.CylinderGeometry(12, 17, 13, 72), metal);
  button.rotation.x = Math.PI / 2;
  button.position.z = 45;
  group.add(button);

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(7, 36, 7), black);
    tab.position.set(Math.cos(angle) * 58, Math.sin(angle) * 58, 23);
    tab.rotation.z = angle;
    group.add(tab);
  }

  return group;
}

function createReel(texture, x, y) {
  const mount = new THREE.Group();
  mount.position.set(x, stageY(y), 16);

  const rotor = new THREE.Group();
  mount.add(rotor);

  const shadowMap = createShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(reelTextureSize * 1.08, reelTextureSize * 1.08),
    new THREE.MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      depthWrite: false,
      opacity: 0.86,
    }),
  );
  shadow.position.set(8, -12, -34);
  mount.add(shadow);

  const pack = new THREE.Mesh(
    new THREE.CircleGeometry(1, 128),
    new THREE.MeshStandardMaterial({
      map: createTapePackTexture(),
      roughness: 0.72,
      metalness: 0.04,
    }),
  );
  pack.position.z = -10;
  rotor.add(pack);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(reelTextureSize, reelTextureSize),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
    }),
  );
  face.position.z = 10;
  rotor.add(face);

  reel3d.scene.add(mount);
  return { mount, rotor, pack };
}

function createRoller() {
  const group = new THREE.Group();
  group.position.set(rollerRestCenter.x, stageY(rollerRestCenter.y), 40);

  const shadowMap = createShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(95, 95),
    new THREE.MeshBasicMaterial({
      map: shadowMap,
      transparent: true,
      depthWrite: false,
      opacity: 0.78,
    }),
  );
  shadow.position.set(5, -6, -18);
  group.add(shadow);

  const wheelAssembly = new THREE.Group();
  group.add(wheelAssembly);

  const side = new THREE.Mesh(
    new THREE.CylinderGeometry(41, 41, 13, 128),
    new THREE.MeshStandardMaterial({
      color: 0x171a19,
      metalness: 0.08,
      roughness: 0.58,
    }),
  );
  side.rotation.x = Math.PI / 2;
  side.position.z = 0;
  wheelAssembly.add(side);

  const metalFace = new THREE.Mesh(
    new THREE.CylinderGeometry(34, 34, 6, 128),
    new THREE.MeshStandardMaterial({
      map: createBrushedMetalTexture(256),
      metalness: 0.88,
      roughness: 0.22,
    }),
  );
  metalFace.rotation.x = Math.PI / 2;
  metalFace.position.z = 8;
  wheelAssembly.add(metalFace);

  const spindle = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 9, 8, 48),
    new THREE.MeshStandardMaterial({
      color: 0x383b38,
      metalness: 0.75,
      roughness: 0.25,
    }),
  );
  spindle.rotation.x = Math.PI / 2;
  spindle.position.z = 18;
  wheelAssembly.add(spindle);

  reel3d.scene.add(group);
  return { group, wheel: wheelAssembly };
}

function resizeReelRenderer() {
  if (!reel3d.renderer) return;
  const { clientWidth, clientHeight } = reelCanvas;
  reel3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  reel3d.renderer.setSize(clientWidth, clientHeight, false);
}

function initReel3d() {
  if (!reelCanvas) return;

  reel3d.renderer = new THREE.WebGLRenderer({
    canvas: reelCanvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  reel3d.renderer.setClearColor(0x000000, 0);
  reel3d.scene = new THREE.Scene();
  reel3d.camera = new THREE.OrthographicCamera(0, referenceWidth, referenceHeight, 0, -500, 500);
  reel3d.camera.position.z = 300;

  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  reel3d.scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(-260, 420, 500);
  reel3d.scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0xe7f0ff, 1.1);
  rimLight.position.set(420, 250, 360);
  reel3d.scene.add(rimLight);

  const loader = new THREE.TextureLoader();
  Promise.all([
    loader.loadAsync("assets/reel-front-face.png"),
  ]).then(([reelTexture]) => {
    [reelTexture].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    });
    const left = createReel(reelTexture, leftReelCenter.x, leftReelCenter.y);
    const right = createReel(reelTexture.clone(), rightReelCenter.x, rightReelCenter.y);
    reel3d.left = left.rotor;
    reel3d.right = right.rotor;
    reel3d.leftPack = left.pack;
    reel3d.rightPack = right.pack;
    reel3d.ready = true;
    updateTapePacks(tapeProgress());
    renderReel3d();
  });

  resizeReelRenderer();
  window.addEventListener("resize", resizeReelRenderer);
}

function setPackRadius(mesh, diameterIn) {
  if (!mesh) return;
  const radius = (diameterIn / reelDiameterIn) * (reelTextureSize / 2);
  mesh.scale.set(radius, radius, 1);
}

function renderReel3d() {
  if (!reel3d.ready) return;
  const leftRad = -THREE.MathUtils.degToRad(reelAngleL);
  const rightRad = -THREE.MathUtils.degToRad(reelAngleR);
  const rollerRad = -THREE.MathUtils.degToRad(capstanAngle);

  reel3d.left.rotation.z = leftRad;
  reel3d.right.rotation.z = rightRad;

  if (reel3d.roller && reel3d.rollerWheel) {
    const engaged = mode === "play" && !audio.paused;
    const target = engaged ? rollerPlayCenter : rollerRestCenter;
    reel3d.roller.position.x += (target.x - reel3d.roller.position.x) * 0.28;
    reel3d.roller.position.y += (stageY(target.y) - reel3d.roller.position.y) * 0.28;
    reel3d.rollerWheel.rotation.z = rollerRad;
  }
  reel3d.renderer.render(reel3d.scene, reel3d.camera);
}

function sevenSegmentMask(character) {
  const masks = {
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
  return masks[character] || "";
}

function renderCounter(seconds) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const text = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const nodes = Array.from(text, (character) => {
    if (character === ":") {
      const colon = document.createElement("span");
      colon.className = "seg-colon";
      return colon;
    }

    const digit = document.createElement("span");
    digit.className = "seg-digit";
    digit.dataset.on = sevenSegmentMask(character);
    ["a", "b", "c", "d", "e", "f", "g"].forEach((segment) => {
      const span = document.createElement("span");
      span.className = segment;
      digit.append(span);
    });
    return digit;
  });
  counter.replaceChildren(...nodes);
}

function setMode(nextMode) {
  mode = nextMode;
  for (const [name, button] of Object.entries(buttons)) {
    button.classList.toggle("active", name === nextMode);
  }
  deck.dataset.mode = nextMode;
}

function ensureAudioGraph() {
  if (audioContext) return;

  audioContext = new AudioContext();
  source = audioContext.createMediaElementSource(audio);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.72;

  splitter = audioContext.createChannelSplitter(2);
  analyserL = audioContext.createAnalyser();
  analyserR = audioContext.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;
  analyserL.smoothingTimeConstant = 0.64;
  analyserR.smoothingTimeConstant = 0.64;

  source.connect(splitter);
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  source.connect(analyser);
  analyser.connect(audioContext.destination);

  dataL = new Uint8Array(analyserL.fftSize);
  dataR = new Uint8Array(analyserR.fftSize);
}

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const centered = (buffer[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / buffer.length);
}

function peak(buffer) {
  let value = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    value = Math.max(value, Math.abs((buffer[i] - 128) / 128));
  }
  return value;
}

function amplitudeToVuDb(value) {
  if (value <= 0.00001) return -60;
  return 20 * Math.log10(value) + meterMaxDb;
}

function meterAngle(dbVu) {
  const value = clamp(dbVu, meterMinDb, meterMaxDb);
  for (let i = 1; i < vuScale.length; i += 1) {
    const prev = vuScale[i - 1];
    const next = vuScale[i];
    if (value <= next.db) {
      const t = (value - prev.db) / (next.db - prev.db);
      return prev.angle + t * (next.angle - prev.angle);
    }
  }
  return vuScale[vuScale.length - 1].angle;
}

function updateMeters(dt) {
  let rawL = -60;
  let rawR = -60;

  if (!audio.paused && analyserL && analyserR) {
    analyserL.getByteTimeDomainData(dataL);
    analyserR.getByteTimeDomainData(dataR);
    rawL = amplitudeToVuDb(Math.max(rms(dataL) * 2.8, peak(dataL)));
    rawR = amplitudeToVuDb(Math.max(rms(dataR) * 2.8, peak(dataR)));
  }

  levelL += (rawL - levelL) * Math.min(1, dt * 9);
  levelR += (rawR - levelR) * Math.min(1, dt * 9);

  const angleL = meterAngle(levelL);
  const angleR = meterAngle(levelR);

  needles.left.style.setProperty("--angle", `${angleL}deg`);
  needles.right.style.setProperty("--angle", `${angleR}deg`);
  updateCssNeedleShadow(needles.leftShadow, angleL);
  updateCssNeedleShadow(needles.rightShadow, angleR);

  leds.left3.classList.toggle("on", angleL >= meterRedStartAngle);
  leds.left6.classList.toggle("on", levelL >= 6);
  leds.right3.classList.toggle("on", angleR >= meterRedStartAngle);
  leds.right6.classList.toggle("on", levelR >= 6);
}

function updateCssNeedleShadow(needleShadow, angleDeg) {
  const radians = angleDeg * (Math.PI / 180);
  needleShadow.style.setProperty("--angle", `${angleDeg}deg`);
  needleShadow.style.setProperty("--shadow-x", `${Math.sin(radians) * 1.4}px`);
  needleShadow.style.setProperty("--shadow-y", `${-3.2 - Math.cos(radians) * 0.5}px`);
}

function setStagePosition(element, point) {
  if (!element) return;
  element.style.left = `${(point.x / referenceWidth) * 100}%`;
  element.style.top = `${(point.y / referenceHeight) * 100}%`;
}

function mixPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
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

function stepSpring(state, target, dt, stiffness, damping) {
  const acceleration = (target - state.lift) * stiffness;
  state.velocity += acceleration * dt;
  state.velocity *= Math.exp(-damping * dt);
  state.lift += state.velocity * dt;
  state.lift = clamp(state.lift, -0.06, 1.24);
  if (target === 0 && state.lift < 0.015 && Math.abs(state.velocity) < 0.08) {
    state.lift = 0;
    state.velocity = 0;
  }
}

function updateTransportPhotos(dt) {
  const pinchEngaged = mode === "play" && !audio.paused;
  stepSpring(pinchRollerState, pinchEngaged ? 1 : 0, dt, 58, 12);
  const pinchPoint = mixPoint(rollerRestCenter, rollerPlayCenter, clamp(pinchRollerState.lift, 0, 1));
  setStagePosition(pinchRollerPhoto, pinchPoint);
  if (pinchRollerPhoto) {
    pinchRollerPhoto.style.setProperty("--pinch-rot", `${capstanAngle}deg`);
  }

  const tapeMoving = Math.abs(transportTapeIps()) > 0;
  if (tapeMoving && !tensionerState.wasMoving) {
    tensionerState.velocity = 8.5 + Math.random() * 4.5;
    tensionerState.wobble = Math.random() * 2 - 1;
  }
  tensionerState.wasMoving = tapeMoving;
  stepSpring(tensionerState, tapeMoving ? 1 : 0, dt, 68, 9.5);
  const leftPoint = tensionerPoint(
    leftTensionerRest,
    leftTensionerRun,
    leftTensionerKick,
    tensionerState.lift,
    tensionerState.wobble,
  );
  const rightPoint = tensionerPoint(
    rightTensionerRest,
    rightTensionerRun,
    rightTensionerKick,
    tensionerState.lift,
    -tensionerState.wobble,
  );
  setStagePosition(tensionerLeft, leftPoint);
  setStagePosition(tensionerRight, rightPoint);
}

function tapeProgress() {
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
  return clamp(audio.currentTime / duration, 0, 1);
}

function tapePackDiameter(progress, side) {
  const hubArea = emptyTapeDiameterIn * emptyTapeDiameterIn;
  const fullArea = fullTapeDiameterIn * fullTapeDiameterIn;
  const tapeArea = fullArea - hubArea;
  const packedArea = side === "left"
    ? fullArea - progress * tapeArea
    : hubArea + progress * tapeArea;
  return Math.sqrt(packedArea);
}

function packRadiusPx(diameterIn) {
  return (diameterIn / reelDiameterIn) * (reelTextureSize / 2);
}

function pointOnPack(center, radius, degrees) {
  const radians = THREE.MathUtils.degToRad(degrees);
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
}

function updateTapePath(progress) {
  const leftRadius = packRadiusPx(tapePackDiameter(progress, "left"));
  const rightRadius = packRadiusPx(tapePackDiameter(progress, "right"));
  const leftExit = pointOnPack(leftReelCenter, leftRadius, 126);
  const rightEntry = pointOnPack(rightReelCenter, rightRadius, 54);
  const leftTensioner = tensionerPoint(
    leftTensionerRest,
    leftTensionerRun,
    leftTensionerKick,
    tensionerState.lift,
    tensionerState.wobble,
  );
  const rightTensioner = tensionerPoint(
    rightTensionerRest,
    rightTensionerRun,
    rightTensionerKick,
    tensionerState.lift,
    -tensionerState.wobble,
  );

  const d = [
    `M ${leftExit.x.toFixed(1)} ${leftExit.y.toFixed(1)}`,
    `C ${(leftExit.x - 25).toFixed(1)} ${(leftExit.y + 70).toFixed(1)} ${(leftTensioner.x - 60).toFixed(1)} ${(leftTensioner.y - 72).toFixed(1)} ${(leftTensioner.x - 34).toFixed(1)} ${(leftTensioner.y - 18).toFixed(1)}`,
    `C ${(leftTensioner.x - 50).toFixed(1)} ${(leftTensioner.y + 24).toFixed(1)} ${(leftTensioner.x - 3).toFixed(1)} ${(leftTensioner.y + 45).toFixed(1)} ${(leftTensioner.x + 38).toFixed(1)} ${(leftTensioner.y + 18).toFixed(1)}`,
    `C ${(leftTensioner.x + 62).toFixed(1)} ${(leftTensioner.y + 1).toFixed(1)} 417.0 718.0 424.0 697.0`,
    "M 465.0 780.0",
    "C 574.0 786.0 731.0 789.0 884.0 780.0",
    "M 918.0 780.0",
    "C 935.0 750.0 945.0 724.0 956.0 703.0",
    `C 1012.0 717.0 ${(rightTensioner.x - 74).toFixed(1)} ${(rightTensioner.y + 29).toFixed(1)} ${(rightTensioner.x - 38).toFixed(1)} ${(rightTensioner.y + 18).toFixed(1)}`,
    `C ${(rightTensioner.x + 3).toFixed(1)} ${(rightTensioner.y + 45).toFixed(1)} ${(rightTensioner.x + 50).toFixed(1)} ${(rightTensioner.y + 24).toFixed(1)} ${(rightTensioner.x + 34).toFixed(1)} ${(rightTensioner.y - 18).toFixed(1)}`,
    `C ${(rightTensioner.x + 60).toFixed(1)} ${(rightTensioner.y - 72).toFixed(1)} ${(rightEntry.x + 24).toFixed(1)} ${(rightEntry.y + 70).toFixed(1)} ${rightEntry.x.toFixed(1)} ${rightEntry.y.toFixed(1)}`,
  ].join(" ");

  movingTape.setAttribute("d", d);
  tapeShadow.setAttribute("d", d);
}

function updateTapePacks(progress) {
  const leftDiameter = tapePackDiameter(progress, "left");
  const rightDiameter = tapePackDiameter(progress, "right");
  const leftPackSize = (leftDiameter / reelDiameterIn) * 100;
  const rightPackSize = (rightDiameter / reelDiameterIn) * 100;
  leftPack.style.setProperty("--pack", `${leftPackSize}%`);
  rightPack.style.setProperty("--pack", `${rightPackSize}%`);
  setPackRadius(reel3d.leftPack, leftDiameter);
  setPackRadius(reel3d.rightPack, rightDiameter);
  updateTapePath(progress);
}

function transportTapeIps() {
  if (mode === "rewind") return -windingSpeedIps;
  if (mode === "ff") return windingSpeedIps;
  if (mode === "play" && !audio.paused) return speedIps;
  return 0;
}

function updateWindPosition(dt) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  if (mode === "rewind") {
    audio.currentTime = clamp(audio.currentTime - dt * windSecondsPerSecond, 0, audio.duration);
  }
  if (mode === "ff") {
    audio.currentTime = clamp(audio.currentTime + dt * windSecondsPerSecond, 0, audio.duration);
  }
}

function angularDegreesPerSecond(linearIps, diameterIn) {
  return (linearIps / (Math.PI * diameterIn)) * 360;
}

function updateMotion(dt) {
  updateWindPosition(dt);
  const progress = tapeProgress();
  const tapeIps = transportTapeIps();
  const direction = Math.sign(tapeIps);
  const linearIps = Math.abs(tapeIps);
  const leftDiameter = tapePackDiameter(progress, "left");
  const rightDiameter = tapePackDiameter(progress, "right");
  const leftDps = angularDegreesPerSecond(linearIps, leftDiameter);
  const rightDps = angularDegreesPerSecond(linearIps, rightDiameter);
  const rollerIps = mode === "play" && !audio.paused ? speedIps : 0;
  const capstanDps = angularDegreesPerSecond(rollerIps, pinchRollerDiameterIn);

  reelAngleL -= direction * leftDps * dt;
  reelAngleR -= direction * rightDps * dt;
  capstanAngle += capstanDps * dt;
  tapeOffset -= direction * linearIps * dt * 10;

  leftReel.style.setProperty("--rot", `${reelAngleL}deg`);
  rightReel.style.setProperty("--rot", `${reelAngleR}deg`);
  capstan.style.setProperty("--capstan-rot", `${capstanAngle}deg`);
  movingTape.style.setProperty("--tape-offset", `${tapeOffset}`);
  updateTransportPhotos(dt);
  updateTapePacks(progress);
  renderReel3d();
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateMotion(dt);
  updateMeters(dt);
  renderCounter(audio.currentTime - zeroOffset);
  requestAnimationFrame(tick);
}

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (!file) return;
  if (selectedUrl) URL.revokeObjectURL(selectedUrl);
  selectedUrl = URL.createObjectURL(file);
  audio.src = selectedUrl;
  zeroOffset = 0;
  trackName.textContent = file.name;
  setMode("stop");
});

buttons.play.addEventListener("click", async () => {
  if (!audio.src) return;
  ensureAudioGraph();
  await audioContext.resume();
  await audio.play();
  setMode("play");
});

buttons.pause.addEventListener("click", async () => {
  if (!audio.src) return;
  if (audio.paused && audio.currentTime > 0) {
    ensureAudioGraph();
    await audioContext.resume();
    await audio.play();
    setMode("play");
    return;
  }
  audio.pause();
  setMode("pause");
});

buttons.stop.addEventListener("click", () => {
  audio.pause();
  audio.currentTime = 0;
  setMode("stop");
});

function startWind(nextMode) {
  if (!audio.src) return;
  windWasPlaying = !audio.paused;
  audio.pause();
  setMode(nextMode);
}

function stopWind() {
  if (mode !== "rewind" && mode !== "ff") return;
  if (windWasPlaying && audio.src) {
    audio.play();
    setMode("play");
    return;
  }
  setMode("stop");
}

buttons.rewind.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  buttons.rewind.setPointerCapture(event.pointerId);
  startWind("rewind");
});

buttons.ff.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  buttons.ff.setPointerCapture(event.pointerId);
  startWind("ff");
});

["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
  buttons.rewind.addEventListener(eventName, stopWind);
  buttons.ff.addEventListener(eventName, stopWind);
});

document.getElementById("zeroButton").addEventListener("click", () => {
  zeroOffset = audio.currentTime || 0;
});

document.querySelectorAll(".speed").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".speed").forEach((speedButton) => speedButton.classList.remove("active"));
    button.classList.add("active");
    speedIps = Number(button.dataset.speed);
  });
});

audio.addEventListener("ended", () => setMode("stop"));
audio.addEventListener("loadedmetadata", () => {
  updateTapePacks(0);
  renderCounter(0);
});

setMode("stop");
renderCounter(0);
updateTransportPhotos(0);
initReel3d();
requestAnimationFrame(tick);
