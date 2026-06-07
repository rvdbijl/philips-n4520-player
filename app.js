const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");
const trackName = document.getElementById("trackName");
const deck = document.getElementById("deck");
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
  const leftPackSize = (tapePackDiameter(progress, "left") / reelDiameterIn) * 100;
  const rightPackSize = (tapePackDiameter(progress, "right") / reelDiameterIn) * 100;
  leftPack.style.setProperty("--pack", `${leftPackSize}%`);
  rightPack.style.setProperty("--pack", `${rightPackSize}%`);
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
  reelAngleR += direction * rightDps * dt;
  capstanAngle += capstanDps * dt;
  tapeOffset -= direction * linearIps * dt * 10;

  leftReel.style.setProperty("--rot", `${reelAngleL}deg`);
  rightReel.style.setProperty("--rot", `${reelAngleR}deg`);
  capstan.style.setProperty("--capstan-rot", `${capstanAngle}deg`);
  movingTape.style.setProperty("--tape-offset", `${tapeOffset}`);
  updateTapePacks(progress);
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
requestAnimationFrame(tick);
