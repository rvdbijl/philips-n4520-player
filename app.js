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
const referenceWidth = 1600;
const referenceHeight = 1200;
const reelTextureSize = 596;
const leftReelCenter = { x: 493, y: 346 };
const rightReelCenter = { x: 1098, y: 346 };
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

function createReel(texture, x, y) {
  const group = new THREE.Group();
  group.position.set(x, stageY(y), 16);

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
  group.add(shadow);

  const pack = new THREE.Mesh(
    new THREE.CircleGeometry(1, 128),
    new THREE.MeshStandardMaterial({
      color: 0x4c281a,
      roughness: 0.72,
      metalness: 0.04,
    }),
  );
  pack.position.z = -5;
  group.add(pack);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(reelTextureSize / 2 - 2, 4.5, 16, 180),
    new THREE.MeshStandardMaterial({
      color: 0xc8c9c2,
      metalness: 0.9,
      roughness: 0.2,
    }),
  );
  rim.position.z = 7;
  group.add(rim);

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
  group.add(face);

  reel3d.scene.add(group);
  return { group, pack };
}

function createRoller(texture) {
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

  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(38, 38, 12, 96),
    new THREE.MeshStandardMaterial({
      color: 0xd8d8cf,
      metalness: 0.88,
      roughness: 0.24,
    }),
  );
  wheel.rotation.x = Math.PI / 2;
  wheel.position.z = 0;
  group.add(wheel);

  const textureFace = new THREE.Mesh(
    new THREE.PlaneGeometry(78, 78),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
    }),
  );
  textureFace.position.z = 8;
  group.add(textureFace);

  reel3d.scene.add(group);
  return group;
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
    loader.loadAsync("assets/left-reel-face.png"),
    loader.loadAsync("assets/right-reel-face.png"),
    loader.loadAsync("assets/capstan-roller.png"),
  ]).then(([leftTexture, rightTexture, rollerTexture]) => {
    [leftTexture, rightTexture, rollerTexture].forEach((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
    });
    const left = createReel(leftTexture, leftReelCenter.x, leftReelCenter.y);
    const right = createReel(rightTexture, rightReelCenter.x, rightReelCenter.y);
    reel3d.left = left.group;
    reel3d.right = right.group;
    reel3d.leftPack = left.pack;
    reel3d.rightPack = right.pack;
    reel3d.roller = createRoller(rollerTexture);
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
  reel3d.roller.rotation.z = rollerRad;

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
  return -43 + shaped * 78;
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

  leds.left3.classList.toggle("on", peakL >= 3);
  leds.left6.classList.toggle("on", peakL >= 6);
  leds.right3.classList.toggle("on", peakR >= 3);
  leds.right6.classList.toggle("on", peakR >= 6);
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

function updateTapePacks(progress) {
  const leftDiameter = tapePackDiameter(progress, "left");
  const rightDiameter = tapePackDiameter(progress, "right");
  const leftPackSize = (leftDiameter / reelDiameterIn) * 100;
  const rightPackSize = (rightDiameter / reelDiameterIn) * 100;
  leftPack.style.setProperty("--pack", `${leftPackSize}%`);
  rightPack.style.setProperty("--pack", `${rightPackSize}%`);
  setPackRadius(reel3d.leftPack, leftDiameter);
  setPackRadius(reel3d.rightPack, rightDiameter);
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
