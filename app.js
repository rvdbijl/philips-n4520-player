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

const buttons = {
  play: document.getElementById("playButton"),
  stop: document.getElementById("stopButton"),
  pause: document.getElementById("pauseButton"),
  rewind: document.getElementById("rewindButton"),
  ff: document.getElementById("ffButton"),
  rec: document.getElementById("recButton"),
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
let peakL = -60;
let peakR = -60;

const reelDiameterIn = 10.5;
const hubDiameterIn = 3.0;
const fullTapeDiameterIn = 9.35;
const windingSpeedIps = 90;
const pinchRollerDiameterIn = 1.15;
const vuCalibrationDb = 15;
const meterMinDb = -30;
const meterMaxDb = 6;
const meterMinAngle = -32;
const meterMaxAngle = 34;
const referenceWidth = 1600;
const referenceHeight = 1200;
const reelTextureSize = 540;
const leftReelCenter = { x: 493, y: 342 };
const rightReelCenter = { x: 1056, y: 342 };
const rollerRestCenter = { x: 914, y: 821 };
const rollerPlayCenter = { x: 914, y: 796 };

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
    color: 0x080909,
    metalness: 0.52,
    roughness: 0.34,
  });
  const darkRubber = new THREE.MeshStandardMaterial({
    color: 0x111313,
    metalness: 0.18,
    roughness: 0.58,
  });
  const metal = new THREE.MeshStandardMaterial({
    map: createBrushedMetalTexture(256),
    metalness: 0.82,
    roughness: 0.23,
  });

  const adapter = new THREE.Mesh(new THREE.CylinderGeometry(72, 76, 22, 96), darkRubber);
  adapter.rotation.x = Math.PI / 2;
  adapter.position.z = 0;
  group.add(adapter);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(58, 8, 18, 96), metal);
  collar.position.z = 13;
  group.add(collar);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(36, 42, 24, 96), black);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 24;
  group.add(cap);

  const button = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 14, 72), metal);
  button.rotation.x = Math.PI / 2;
  button.position.z = 45;
  group.add(button);

  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const tab = new THREE.Mesh(new THREE.BoxGeometry(12, 42, 9), black);
    tab.position.set(Math.cos(angle) * 74, Math.sin(angle) * 74, 15);
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

  const rearRim = new THREE.Mesh(
    new THREE.TorusGeometry(reelTextureSize / 2 - 7, 3.2, 14, 180),
    new THREE.MeshStandardMaterial({
      color: 0x8f918c,
      metalness: 0.86,
      roughness: 0.32,
    }),
  );
  rearRim.position.z = -10;
  rotor.add(rearRim);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(reelTextureSize / 2 - 2, 4.5, 16, 180),
    new THREE.MeshStandardMaterial({
      color: 0xc8c9c2,
      metalness: 0.9,
      roughness: 0.2,
    }),
  );
  rim.position.z = 7;
  rotor.add(rim);

  const lipHighlight = new THREE.Mesh(
    new THREE.TorusGeometry(reelTextureSize / 2 - 13, 1.4, 10, 180),
    new THREE.MeshStandardMaterial({
      color: 0xe4e4dc,
      metalness: 0.92,
      roughness: 0.18,
      transparent: true,
      opacity: 0.72,
    }),
  );
  lipHighlight.position.z = 12;
  rotor.add(lipHighlight);

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

  rotor.add(createSpindleAssembly());

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

  const rubber = new THREE.Mesh(
    new THREE.TorusGeometry(39, 4.2, 16, 96),
    new THREE.MeshStandardMaterial({
      color: 0x171a19,
      metalness: 0.16,
      roughness: 0.54,
    }),
  );
  rubber.position.z = 4;
  wheelAssembly.add(rubber);

  const metalFace = new THREE.Mesh(
    new THREE.CylinderGeometry(35, 35, 16, 128),
    new THREE.MeshStandardMaterial({
      map: createBrushedMetalTexture(256),
      metalness: 0.88,
      roughness: 0.22,
    }),
  );
  metalFace.rotation.x = Math.PI / 2;
  metalFace.position.z = 7;
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
    const roller = createRoller();
    reel3d.roller = roller.group;
    reel3d.rollerWheel = roller.wheel;
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

  const engaged = mode === "play" && !audio.paused;
  const target = engaged ? rollerPlayCenter : rollerRestCenter;
  reel3d.roller.position.x += (target.x - reel3d.roller.position.x) * 0.28;
  reel3d.roller.position.y += (stageY(target.y) - reel3d.roller.position.y) * 0.28;
  reel3d.rollerWheel.rotation.z = rollerRad;
  reel3d.renderer.render(reel3d.scene, reel3d.camera);
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
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

function rmsToVuDb(value) {
  if (value <= 0.00001) return -60;
  return 20 * Math.log10(value) + vuCalibrationDb;
}

function meterAngle(dbVu) {
  const normalized = clamp((dbVu - meterMinDb) / (meterMaxDb - meterMinDb), 0, 1);
  const shaped = Math.pow(normalized, 0.9);
  return meterMinAngle + shaped * (meterMaxAngle - meterMinAngle);
}

function updateMeters(dt) {
  let rawL = -60;
  let rawR = -60;

  if (!audio.paused && analyserL && analyserR) {
    analyserL.getByteTimeDomainData(dataL);
    analyserR.getByteTimeDomainData(dataR);
    rawL = rmsToVuDb(rms(dataL));
    rawR = rmsToVuDb(rms(dataR));
  }

  levelL += (rawL - levelL) * Math.min(1, dt * 9);
  levelR += (rawR - levelR) * Math.min(1, dt * 9);
  peakL = Math.max(levelL, peakL - dt * 14);
  peakR = Math.max(levelR, peakR - dt * 14);

  needles.left.style.setProperty("--angle", `${meterAngle(levelL)}deg`);
  needles.right.style.setProperty("--angle", `${meterAngle(levelR)}deg`);
  updateCssNeedleShadow(needles.leftShadow, meterAngle(levelL));
  updateCssNeedleShadow(needles.rightShadow, meterAngle(levelR));

  leds.left3.classList.toggle("on", peakL >= 3);
  leds.left6.classList.toggle("on", peakL >= 6);
  leds.right3.classList.toggle("on", peakR >= 3);
  leds.right6.classList.toggle("on", peakR >= 6);
}

function updateCssNeedleShadow(needleShadow, angleDeg) {
  const radians = angleDeg * (Math.PI / 180);
  needleShadow.style.setProperty("--angle", `${angleDeg}deg`);
  needleShadow.style.setProperty("--shadow-x", `${Math.sin(radians) * 1.4}px`);
  needleShadow.style.setProperty("--shadow-y", `${-3.2 - Math.cos(radians) * 0.5}px`);
}

function tapeProgress() {
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
  return clamp(audio.currentTime / duration, 0, 1);
}

function tapePackDiameter(progress, side) {
  const hubArea = hubDiameterIn * hubDiameterIn;
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
  const leftExit = pointOnPack(leftReelCenter, leftRadius, 82);
  const rightEntry = pointOnPack(rightReelCenter, rightRadius, 108);

  const d = [
    `M ${leftExit.x.toFixed(1)} ${leftExit.y.toFixed(1)}`,
    `C ${(leftExit.x - 48).toFixed(1)} ${(leftExit.y + 55).toFixed(1)} 455.0 717.0 410.0 760.0`,
    "C 466.0 744.0 524.0 721.0 590.0 699.0",
    "C 672.0 672.0 739.0 681.0 804.0 692.0",
    "C 890.0 707.0 958.0 691.0 1045.0 714.0",
    "C 1114.0 733.0 1162.0 751.0 1192.0 708.0",
    `C 1166.0 664.0 ${(rightEntry.x + 55).toFixed(1)} ${(rightEntry.y + 50).toFixed(1)} ${rightEntry.x.toFixed(1)} ${rightEntry.y.toFixed(1)}`,
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

function angularDegreesPerSecond(linearIps, diameterIn) {
  return (linearIps / (Math.PI * diameterIn)) * 360;
}

function updateMotion(dt) {
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
  updateTapePacks(progress);
  renderReel3d();
}

function tick(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateMotion(dt);
  updateMeters(dt);
  counter.textContent = formatTime(audio.currentTime - zeroOffset);
  requestAnimationFrame(tick);
}

function skip(seconds) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = clamp(audio.currentTime + seconds, 0, audio.duration);
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

buttons.pause.addEventListener("click", () => {
  audio.pause();
  setMode("pause");
});

buttons.stop.addEventListener("click", () => {
  audio.pause();
  audio.currentTime = 0;
  setMode("stop");
});

buttons.rewind.addEventListener("click", () => {
  skip(-10);
  setMode("rewind");
  window.setTimeout(() => {
    if (mode === "rewind") setMode(audio.paused ? "stop" : "play");
  }, 450);
});

buttons.ff.addEventListener("click", () => {
  skip(10);
  setMode("ff");
  window.setTimeout(() => {
    if (mode === "ff") setMode(audio.paused ? "stop" : "play");
  }, 450);
});

buttons.rec.addEventListener("click", () => {
  buttons.rec.classList.toggle("active");
});

document.getElementById("zeroButton").addEventListener("click", () => {
  zeroOffset = audio.currentTime || 0;
});

document.getElementById("cueButton").addEventListener("click", () => {
  audio.currentTime = zeroOffset;
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
  counter.textContent = "00:00.0";
});

setMode("stop");
initReel3d();
requestAnimationFrame(tick);
