// ../../../../tmp/sendspin-js-3.2.0/dist/audio/decoder.js
var SendspinDecoder = class {
  constructor(onDecodedChunk, currentGeneration) {
    this.webCodecsDecoder = null;
    this.webCodecsDecoderReady = null;
    this.webCodecsFormat = null;
    this.useNativeOpus = true;
    this.nativeDecoderQueue = [];
    this.opusDecoder = null;
    this.opusDecoderModule = null;
    this.opusDecoderReady = null;
    this.flacDecodingContext = null;
    this.flacDecodingContextSampleRate = 0;
    this.flacDecodingContextChannels = 0;
    this.onDecodedChunk = onDecodedChunk;
    this.currentGeneration = currentGeneration;
  }
  /**
   * Handle a binary audio message from the WebSocket.
   * Parses the message, decodes the audio, and emits a DecodedAudioChunk.
   */
  async handleBinaryMessage(data, format, generation) {
    const firstByte = new Uint8Array(data)[0];
    if (firstByte === 4) {
      const timestampView = new DataView(data, 1, 8);
      const serverTimeUs = Number(timestampView.getBigInt64(0, false));
      const audioData = data.slice(9);
      if (format.codec === "opus" && this.useNativeOpus) {
        await this.initWebCodecsDecoder(format);
        if (this.useNativeOpus && this.webCodecsDecoder) {
          if (this.queueToNativeOpusDecoder(audioData, serverTimeUs, generation)) {
            return;
          }
        }
      }
      try {
        const decoded = await this.decode(audioData, format);
        if (decoded && generation === this.currentGeneration()) {
          this.onDecodedChunk({
            samples: decoded.samples,
            sampleRate: decoded.sampleRate,
            serverTimeUs,
            generation
          });
        }
      } catch (error) {
        console.error("Sendspin: Failed to decode audio buffer:", error);
      }
    }
  }
  async decode(audioData, format) {
    if (format.codec === "opus") {
      return this.decodeOpusWithEncdec(audioData, format);
    } else if (format.codec === "flac") {
      return this.decodeFLAC(audioData, format);
    } else if (format.codec === "pcm") {
      return this.decodePCM(audioData, format);
    }
    return null;
  }
  // ========================================
  // PCM Decoder
  // ========================================
  decodePCM(audioData, format) {
    const bytesPerSample = (format.bit_depth || 16) / 8;
    const dataView = new DataView(audioData);
    const numSamples = audioData.byteLength / (bytesPerSample * format.channels);
    const samples = [];
    for (let ch = 0; ch < format.channels; ch++) {
      samples.push(new Float32Array(numSamples));
    }
    for (let channel = 0; channel < format.channels; channel++) {
      const channelData = samples[channel];
      for (let i = 0; i < numSamples; i++) {
        const offset = (i * format.channels + channel) * bytesPerSample;
        let sample = 0;
        if (format.bit_depth === 16) {
          sample = dataView.getInt16(offset, true) / 32768;
        } else if (format.bit_depth === 24) {
          const byte1 = dataView.getUint8(offset);
          const byte2 = dataView.getUint8(offset + 1);
          const byte3 = dataView.getUint8(offset + 2);
          let int24 = byte3 << 16 | byte2 << 8 | byte1;
          if (int24 & 8388608) {
            int24 |= 4278190080;
          }
          sample = int24 / 8388608;
        } else if (format.bit_depth === 32) {
          sample = dataView.getInt32(offset, true) / 2147483648;
        }
        channelData[i] = sample;
      }
    }
    return { samples, sampleRate: format.sample_rate };
  }
  // ========================================
  // FLAC Decoder (uses OfflineAudioContext)
  // ========================================
  getFlacDecodingContext(sampleRate, channels) {
    if (!this.flacDecodingContext || this.flacDecodingContextSampleRate !== sampleRate || this.flacDecodingContextChannels !== channels) {
      this.flacDecodingContext = new OfflineAudioContext(channels, 1, sampleRate);
      this.flacDecodingContextSampleRate = sampleRate;
      this.flacDecodingContextChannels = channels;
    }
    return this.flacDecodingContext;
  }
  async decodeFLAC(audioData, format) {
    try {
      let dataToEncode = audioData;
      if (format.codec_header) {
        const headerBytes = Uint8Array.from(atob(format.codec_header), (c) => c.charCodeAt(0));
        const combined = new Uint8Array(headerBytes.length + audioData.byteLength);
        combined.set(headerBytes, 0);
        combined.set(new Uint8Array(audioData), headerBytes.length);
        dataToEncode = combined.buffer;
      }
      const ctx = this.getFlacDecodingContext(format.sample_rate, format.channels);
      const audioBuffer = await ctx.decodeAudioData(dataToEncode);
      const samples = [];
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        samples.push(new Float32Array(audioBuffer.getChannelData(ch)));
      }
      return { samples, sampleRate: audioBuffer.sampleRate };
    } catch (error) {
      console.error("Error decoding FLAC data:", error);
      return null;
    }
  }
  // ========================================
  // Opus - Native WebCodecs Decoder
  // ========================================
  async initWebCodecsDecoder(format) {
    const tryConfigureExistingDecoder = () => {
      if (!this.webCodecsDecoder)
        return false;
      const matchesFormat = !!this.webCodecsFormat && this.webCodecsFormat.sample_rate === format.sample_rate && this.webCodecsFormat.channels === format.channels;
      if (this.webCodecsDecoder.state === "configured" && matchesFormat) {
        return true;
      }
      if (this.webCodecsDecoder.state === "closed") {
        return false;
      }
      try {
        this.webCodecsDecoder.configure({
          codec: "opus",
          sampleRate: format.sample_rate,
          numberOfChannels: format.channels
        });
        this.webCodecsFormat = format;
        return true;
      } catch {
        return false;
      }
    };
    if (tryConfigureExistingDecoder()) {
      return;
    }
    if (this.webCodecsDecoderReady) {
      await this.webCodecsDecoderReady;
      if (tryConfigureExistingDecoder()) {
        return;
      }
      try {
        this.webCodecsDecoder?.close();
      } catch {
      }
      this.webCodecsDecoder = null;
      this.webCodecsDecoderReady = null;
      this.webCodecsFormat = null;
    }
    if (this.webCodecsDecoderReady) {
      await this.webCodecsDecoderReady;
      return;
    }
    this.webCodecsDecoderReady = this.createWebCodecsDecoder(format);
    await this.webCodecsDecoderReady;
  }
  async createWebCodecsDecoder(format) {
    if (typeof AudioDecoder === "undefined") {
      this.useNativeOpus = false;
      return;
    }
    try {
      const support = await AudioDecoder.isConfigSupported({
        codec: "opus",
        sampleRate: format.sample_rate,
        numberOfChannels: format.channels
      });
      if (!support.supported) {
        console.log("[NativeOpus] WebCodecs Opus not supported, will use fallback");
        this.useNativeOpus = false;
        return;
      }
      this.webCodecsDecoder = new AudioDecoder({
        output: (audioData) => this.handleAudioData(audioData),
        error: (error) => {
          console.error("[NativeOpus] WebCodecs decoder error:", error);
        }
      });
      this.webCodecsDecoder.configure({
        codec: "opus",
        sampleRate: format.sample_rate,
        numberOfChannels: format.channels
      });
      this.webCodecsFormat = format;
      console.log(`[NativeOpus] Using WebCodecs AudioDecoder: ${format.sample_rate}Hz, ${format.channels}ch`);
    } catch (error) {
      console.warn("[NativeOpus] WebCodecs init failed, will use fallback:", error);
      this.useNativeOpus = false;
    }
  }
  // Handle decoded audio data from native Opus decoder
  handleAudioData(audioData) {
    try {
      const outputTimestampUs = Number(audioData.timestamp);
      const metadata = this.nativeDecoderQueue.shift();
      if (!metadata) {
        console.warn(`[NativeOpus] Dropping frame with empty decode queue (out ts=${outputTimestampUs})`);
        audioData.close();
        return;
      }
      const { serverTimeUs, generation } = metadata;
      if (generation !== this.currentGeneration()) {
        console.warn(`[NativeOpus] Dropping old-stream frame (ts=${serverTimeUs}, gen=${generation} != current=${this.currentGeneration()})`);
        audioData.close();
        return;
      }
      const channels = audioData.numberOfChannels;
      const frames = audioData.numberOfFrames;
      const fmt = audioData.format;
      let interleaved;
      if (fmt === "f32-planar") {
        interleaved = new Float32Array(frames * channels);
        for (let ch = 0; ch < channels; ch++) {
          const channelData = new Float32Array(frames);
          audioData.copyTo(channelData, { planeIndex: ch });
          for (let i = 0; i < frames; i++) {
            interleaved[i * channels + ch] = channelData[i];
          }
        }
      } else if (fmt === "f32") {
        interleaved = new Float32Array(frames * channels);
        audioData.copyTo(interleaved, { planeIndex: 0 });
      } else if (fmt === "s16-planar") {
        interleaved = new Float32Array(frames * channels);
        for (let ch = 0; ch < channels; ch++) {
          const channelData = new Int16Array(frames);
          audioData.copyTo(channelData, { planeIndex: ch });
          for (let i = 0; i < frames; i++) {
            interleaved[i * channels + ch] = channelData[i] / 32768;
          }
        }
      } else if (fmt === "s16") {
        const int16Data = new Int16Array(frames * channels);
        audioData.copyTo(int16Data, { planeIndex: 0 });
        interleaved = new Float32Array(frames * channels);
        for (let i = 0; i < frames * channels; i++) {
          interleaved[i] = int16Data[i] / 32768;
        }
      } else {
        console.warn(`[NativeOpus] Unsupported AudioData format: ${fmt}`);
        audioData.close();
        return;
      }
      this.emitDeinterleavedChunk(interleaved, serverTimeUs, channels, generation);
      audioData.close();
    } catch (e) {
      console.error("[NativeOpus] Error in output callback:", e);
      audioData.close();
    }
  }
  emitDeinterleavedChunk(interleaved, serverTimeUs, channels, generation) {
    if (!this.webCodecsFormat)
      return;
    const numFrames = interleaved.length / channels;
    const samples = [];
    for (let ch = 0; ch < channels; ch++) {
      const channelData = new Float32Array(numFrames);
      for (let i = 0; i < numFrames; i++) {
        channelData[i] = interleaved[i * channels + ch];
      }
      samples.push(channelData);
    }
    this.onDecodedChunk({
      samples,
      sampleRate: this.webCodecsFormat.sample_rate,
      serverTimeUs,
      generation
    });
  }
  queueToNativeOpusDecoder(audioData, serverTimeUs, generation) {
    if (!this.webCodecsDecoder || this.webCodecsDecoder.state !== "configured") {
      return false;
    }
    try {
      this.nativeDecoderQueue.push({
        serverTimeUs,
        generation
      });
      const chunk = new EncodedAudioChunk({
        type: "key",
        timestamp: serverTimeUs,
        data: audioData
      });
      this.webCodecsDecoder.decode(chunk);
      return true;
    } catch (error) {
      if (this.nativeDecoderQueue.length > 0) {
        this.nativeDecoderQueue.pop();
      }
      console.error("[NativeOpus] WebCodecs queue error:", error);
      return false;
    }
  }
  // ========================================
  // Opus - Fallback (opus-encdec library)
  // ========================================
  resolveOpusDecoderModule(moduleExport) {
    const maybeDefault = moduleExport?.default;
    const maybeCommonJs = moduleExport?.["module.exports"];
    const resolved = maybeDefault ?? maybeCommonJs ?? moduleExport;
    if (!resolved || typeof resolved !== "object") {
      throw new Error("[Opus] Invalid libopus decoder module export");
    }
    return resolved;
  }
  resolveOggOpusDecoderClass(wrapperExport) {
    const maybeDefault = wrapperExport?.default;
    const maybeCommonJs = wrapperExport?.["module.exports"];
    const wrapper = maybeDefault ?? maybeCommonJs ?? wrapperExport;
    const resolved = wrapper?.OggOpusDecoder ?? wrapper;
    if (typeof resolved !== "function") {
      throw new Error("[Opus] OggOpusDecoder class export not found");
    }
    return resolved;
  }
  async waitForOpusReady(target) {
    if (target.isReady)
      return;
    if (Object.isExtensible(target)) {
      await new Promise((resolve) => {
        target.onready = () => resolve();
      });
      return;
    }
    while (!target.isReady) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async initOpusEncdecDecoder(format) {
    if (this.opusDecoderReady) {
      await this.opusDecoderReady;
      return;
    }
    this.opusDecoderReady = (async () => {
      console.log("[Opus] Initializing decoder (opus-encdec)...");
      const [DecoderModuleExport, DecoderWrapperExport] = await Promise.all([
        import("opus-encdec/dist/libopus-decoder.js"),
        import("opus-encdec/src/oggOpusDecoder.js")
      ]);
      this.opusDecoderModule = this.resolveOpusDecoderModule(DecoderModuleExport);
      const OggOpusDecoderClass = this.resolveOggOpusDecoderClass(DecoderWrapperExport);
      await this.waitForOpusReady(this.opusDecoderModule);
      this.opusDecoder = new OggOpusDecoderClass({
        rawOpus: true,
        decoderSampleRate: format.sample_rate,
        outputBufferSampleRate: format.sample_rate,
        numberOfChannels: format.channels
      }, this.opusDecoderModule);
      await this.waitForOpusReady(this.opusDecoder);
      console.log("[Opus] Decoder ready");
    })();
    await this.opusDecoderReady;
  }
  async decodeOpusWithEncdec(audioData, format) {
    try {
      await this.initOpusEncdecDecoder(format);
      const uint8Array = new Uint8Array(audioData);
      const decodedSamples = [];
      this.opusDecoder.decodeRaw(uint8Array, (samples2) => {
        decodedSamples.push(new Float32Array(samples2));
      });
      if (decodedSamples.length === 0) {
        console.warn("[Opus] Fallback decoder produced no samples");
        return null;
      }
      const interleavedSamples = decodedSamples[0];
      const numFrames = interleavedSamples.length / format.channels;
      const samples = [];
      for (let ch = 0; ch < format.channels; ch++) {
        const channelData = new Float32Array(numFrames);
        for (let i = 0; i < numFrames; i++) {
          channelData[i] = interleavedSamples[i * format.channels + ch];
        }
        samples.push(channelData);
      }
      return { samples, sampleRate: format.sample_rate };
    } catch (error) {
      console.error("[Opus] Decode error:", error);
      return null;
    }
  }
  // ========================================
  // Lifecycle
  // ========================================
  /** Clear decoder state (on stream change/clear). Drops in-flight async decodes. */
  clearState() {
    this.nativeDecoderQueue = [];
    try {
      this.webCodecsDecoder?.close();
    } catch {
    }
    this.webCodecsDecoder = null;
    this.webCodecsDecoderReady = null;
    this.webCodecsFormat = null;
  }
  /** Full cleanup (on disconnect). Releases all decoder resources. */
  close() {
    this.clearState();
    if (this.opusDecoder) {
      this.opusDecoder = null;
      this.opusDecoderModule = null;
      this.opusDecoderReady = null;
    }
    this.useNativeOpus = true;
    this.flacDecodingContext = null;
    this.flacDecodingContextSampleRate = 0;
    this.flacDecodingContextChannels = 0;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/time-sync-manager.js
var TIME_SYNC_BURST_SIZE = 8;
var TIME_SYNC_BURST_INTERVAL_MS = 1e4;
var TIME_SYNC_REQUEST_TIMEOUT_MS = 2e3;
var TIME_SYNC_ROBUST_SELECTION_COUNT = 3;
var TimeSyncManager = class {
  constructor(wsManager, stateManager, timeFilter) {
    this.wsManager = wsManager;
    this.stateManager = stateManager;
    this.timeFilter = timeFilter;
    this.timeSyncBurstActive = false;
    this.timeSyncBurstSentCount = 0;
    this.timeSyncInFlightClientTransmitted = null;
    this.timeSyncInFlightTimeout = null;
    this.timeSyncBurstSamples = [];
  }
  // Start an initial burst and schedule recurring bursts.
  startAndSchedule() {
    this.stop();
    this.startTimeSyncBurstIfIdle();
    this.scheduleNextTimeSyncBurstTick();
  }
  // Schedule the next fixed 10s burst tick.
  scheduleNextTimeSyncBurstTick() {
    const timeSyncTimeout = globalThis.setTimeout(() => {
      this.startTimeSyncBurstIfIdle();
      this.scheduleNextTimeSyncBurstTick();
    }, TIME_SYNC_BURST_INTERVAL_MS);
    this.stateManager.setTimeSyncInterval(timeSyncTimeout);
  }
  startTimeSyncBurstIfIdle() {
    if (this.timeSyncBurstActive || !this.wsManager.isConnected()) {
      return;
    }
    this.timeSyncBurstActive = true;
    this.timeSyncBurstSentCount = 0;
    this.timeSyncBurstSamples = [];
    this.timeSyncInFlightClientTransmitted = null;
    this.sendNextTimeSyncBurstProbe();
  }
  sendNextTimeSyncBurstProbe() {
    if (!this.timeSyncBurstActive || this.timeSyncInFlightClientTransmitted !== null || !this.wsManager.isConnected()) {
      return;
    }
    if (this.timeSyncBurstSentCount >= TIME_SYNC_BURST_SIZE) {
      this.finalizeTimeSyncBurst();
      return;
    }
    const clientTransmitted = this.sendTimeSync();
    this.timeSyncBurstSentCount += 1;
    this.timeSyncInFlightClientTransmitted = clientTransmitted;
    this.armTimeSyncProbeTimeout(clientTransmitted);
  }
  armTimeSyncProbeTimeout(expectedClientTransmitted) {
    this.clearTimeSyncProbeTimeout();
    this.timeSyncInFlightTimeout = globalThis.setTimeout(() => {
      this.handleTimeSyncProbeTimeout(expectedClientTransmitted);
    }, TIME_SYNC_REQUEST_TIMEOUT_MS);
  }
  clearTimeSyncProbeTimeout() {
    if (this.timeSyncInFlightTimeout !== null) {
      clearTimeout(this.timeSyncInFlightTimeout);
      this.timeSyncInFlightTimeout = null;
    }
  }
  handleTimeSyncProbeTimeout(expectedClientTransmitted) {
    if (!this.timeSyncBurstActive || this.timeSyncInFlightClientTransmitted !== expectedClientTransmitted) {
      return;
    }
    console.warn("Sendspin: Time sync probe timed out, aborting current burst");
    this.abortTimeSyncBurst();
  }
  finalizeTimeSyncBurst() {
    this.clearTimeSyncProbeTimeout();
    const candidate = this.selectTimeSyncBurstCandidate();
    if (candidate) {
      this.timeFilter.update(candidate.measurement, candidate.maxError, candidate.t4);
    }
    this.timeSyncBurstActive = false;
    this.timeSyncBurstSentCount = 0;
    this.timeSyncInFlightClientTransmitted = null;
    this.timeSyncBurstSamples = [];
  }
  selectTimeSyncBurstCandidate() {
    if (this.timeSyncBurstSamples.length === 0) {
      return null;
    }
    const topRttSamples = [...this.timeSyncBurstSamples].sort((a, b) => a.rttTerm - b.rttTerm).slice(0, Math.min(TIME_SYNC_ROBUST_SELECTION_COUNT, this.timeSyncBurstSamples.length));
    const sortedByMeasurement = [...topRttSamples].sort((a, b) => a.measurement - b.measurement);
    return sortedByMeasurement[Math.floor(sortedByMeasurement.length / 2)];
  }
  abortTimeSyncBurst() {
    this.clearTimeSyncProbeTimeout();
    this.timeSyncBurstActive = false;
    this.timeSyncBurstSentCount = 0;
    this.timeSyncInFlightClientTransmitted = null;
    this.timeSyncBurstSamples = [];
  }
  // Stop all time sync activity (interval + in-flight burst).
  stop() {
    this.stateManager.clearTimeSyncInterval();
    this.abortTimeSyncBurst();
  }
  // Handle server/time response
  handleServerTime(message) {
    if (!this.timeSyncBurstActive || this.timeSyncInFlightClientTransmitted === null) {
      return;
    }
    const T1 = message.payload.client_transmitted;
    if (T1 !== this.timeSyncInFlightClientTransmitted) {
      console.warn("Sendspin: Ignoring out-of-order time response", T1, this.timeSyncInFlightClientTransmitted);
      return;
    }
    const T4 = Math.floor(performance.now() * 1e3);
    const T2 = message.payload.server_received;
    const T3 = message.payload.server_transmitted;
    const measurement = (T2 - T1 + (T3 - T4)) / 2;
    const rttTerm = Math.max(0, T4 - T1 - (T3 - T2));
    const maxError = Math.max(1e3, rttTerm / 2);
    this.timeSyncBurstSamples.push({
      measurement,
      maxError,
      t4: T4,
      rttTerm
    });
    this.clearTimeSyncProbeTimeout();
    this.timeSyncInFlightClientTransmitted = null;
    if (this.timeSyncBurstSentCount >= TIME_SYNC_BURST_SIZE) {
      this.finalizeTimeSyncBurst();
      return;
    }
    this.sendNextTimeSyncBurstProbe();
  }
  // Send time synchronization message
  sendTimeSync(clientTimeUs = Math.floor(performance.now() * 1e3)) {
    const message = {
      type: "client/time",
      payload: {
        client_transmitted: clientTimeUs
      }
    };
    this.wsManager.send(message);
    return clientTimeUs;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/codec-support.js
function getBrowserSupportedCodecs() {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isSafari = /^((?!chrome|android).)*safari/i.test(userAgent);
  const isFirefox = /firefox/i.test(userAgent);
  const hasNativeOpus = typeof AudioDecoder !== "undefined";
  if (!hasNativeOpus) {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      console.warn("[Opus] Running in insecure context, falling back to FLAC/PCM");
    } else {
      console.warn("[Opus] Native decoder not available, falling back to FLAC/PCM");
    }
  }
  if (isSafari) {
    return /* @__PURE__ */ new Set(["pcm", "opus"]);
  }
  if (isFirefox) {
    return /* @__PURE__ */ new Set(["pcm", "flac"]);
  }
  if (hasNativeOpus) {
    return /* @__PURE__ */ new Set(["pcm", "opus", "flac"]);
  }
  return /* @__PURE__ */ new Set(["pcm", "flac"]);
}
function getSupportedFormats(codecs) {
  const browserSupported = getBrowserSupportedCodecs();
  const formats = [];
  for (const codec of codecs) {
    if (!browserSupported.has(codec)) {
      continue;
    }
    if (codec === "opus") {
      formats.push({
        codec: "opus",
        sample_rate: 48e3,
        channels: 2,
        bit_depth: 16
      });
    } else {
      formats.push({ codec, sample_rate: 48e3, channels: 2, bit_depth: 16 });
      formats.push({ codec, sample_rate: 44100, channels: 2, bit_depth: 16 });
    }
  }
  if (formats.length === 0) {
    throw new Error(`No supported codecs: requested [${codecs.join(", ")}], browser supports [${[...browserSupported].join(", ")}]`);
  }
  return formats;
}

// ../../../../tmp/sendspin-js-3.2.0/dist/sync-delay.js
var SYNC_DELAY_MAX_MS = 5e3;
function clampSyncDelayMs(delayMs) {
  if (!isFinite(delayMs))
    return 0;
  return Math.max(0, Math.min(SYNC_DELAY_MAX_MS, Math.round(delayMs)));
}

// ../../../../tmp/sendspin-js-3.2.0/dist/core/protocol-handler.js
var STATE_UPDATE_INTERVAL = 5e3;
var DEFAULT_REQUIRED_LEAD_TIME_MS = 250;
var DEFAULT_MIN_BUFFER_MS = 250;
function assertBufferMs(value, name) {
  if (!isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}
var ProtocolHandler = class {
  constructor(playerId, wsManager, streamHandler, stateManager, timeFilter, config = {}) {
    this.playerId = playerId;
    this.wsManager = wsManager;
    this.streamHandler = streamHandler;
    this.stateManager = stateManager;
    this.timeFilter = timeFilter;
    this.clientName = config.clientName ?? "Sendspin Player";
    this.codecs = config.codecs ?? ["opus", "flac", "pcm"];
    this.bufferCapacity = config.bufferCapacity ?? 1024 * 1024 * 5;
    this.requiredLeadTimeMs = config.requiredLeadTimeMs ?? DEFAULT_REQUIRED_LEAD_TIME_MS;
    assertBufferMs(this.requiredLeadTimeMs, "requiredLeadTimeMs");
    this.minBufferMs = config.minBufferMs ?? DEFAULT_MIN_BUFFER_MS;
    assertBufferMs(this.minBufferMs, "minBufferMs");
    this.useHardwareVolume = config.useHardwareVolume ?? false;
    this.onVolumeCommand = config.onVolumeCommand;
    this.onDelayCommand = config.onDelayCommand;
    this.getExternalVolume = config.getExternalVolume;
    this.timeSyncManager = new TimeSyncManager(wsManager, stateManager, timeFilter);
  }
  // Handle WebSocket messages
  handleMessage(event) {
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data);
      this.handleServerMessage(message);
    } else if (event.data instanceof ArrayBuffer) {
      this.streamHandler.handleBinaryMessage(event.data);
    } else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buffer) => {
        this.streamHandler.handleBinaryMessage(buffer);
      });
    }
  }
  // Handle server messages
  handleServerMessage(message) {
    switch (message.type) {
      case "server/hello":
        this.handleServerHello();
        break;
      case "server/time":
        this.timeSyncManager.handleServerTime(message);
        break;
      case "stream/start":
        this.handleStreamStart(message);
        break;
      case "stream/clear":
        this.handleStreamClear(message);
        break;
      case "stream/end":
        this.handleStreamEnd(message);
        break;
      case "server/command":
        this.handleServerCommand(message);
        break;
      case "server/state":
        this.stateManager.updateServerState(message.payload);
        break;
      case "group/update":
        this.stateManager.updateGroupState(message.payload);
        break;
    }
  }
  // Handle server hello
  handleServerHello() {
    console.log("Sendspin: Connected to server");
    this.sendStateUpdate();
    this.timeSyncManager.startAndSchedule();
    const stateInterval = globalThis.setInterval(() => this.sendStateUpdate(), STATE_UPDATE_INTERVAL);
    this.stateManager.setStateUpdateInterval(stateInterval);
  }
  // Restart the periodic state update interval.
  // Called after volume commands to prevent a pending periodic update
  // from sending stale hardware volume shortly after the command response.
  restartStateUpdateInterval() {
    const newInterval = globalThis.setInterval(() => this.sendStateUpdate(), STATE_UPDATE_INTERVAL);
    this.stateManager.setStateUpdateInterval(newInterval);
  }
  stopTimeSync() {
    this.timeSyncManager.stop();
  }
  handleStreamStart(message) {
    const isFormatUpdate = this.stateManager.currentStreamFormat !== null;
    this.stateManager.currentStreamFormat = message.payload.player;
    console.log(isFormatUpdate ? "Sendspin: Stream format updated" : "Sendspin: Stream started", this.stateManager.currentStreamFormat);
    console.log(`Sendspin: Codec=${this.stateManager.currentStreamFormat.codec.toUpperCase()}, SampleRate=${this.stateManager.currentStreamFormat.sample_rate}Hz, Channels=${this.stateManager.currentStreamFormat.channels}, BitDepth=${this.stateManager.currentStreamFormat.bit_depth}bit`);
    this.streamHandler.handleStreamStart(this.stateManager.currentStreamFormat, isFormatUpdate);
    this.stateManager.isPlaying = true;
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      navigator.mediaSession.playbackState = "playing";
    }
  }
  handleStreamClear(message) {
    const roles = message.payload.roles;
    if (!roles || roles.includes("player")) {
      console.log("Sendspin: Stream clear (seek)");
      this.streamHandler.handleStreamClear();
    }
  }
  handleStreamEnd(message) {
    const roles = message.payload?.roles;
    if (!roles || roles.includes("player")) {
      console.log("Sendspin: Stream ended");
      this.streamHandler.handleStreamEnd();
      this.stateManager.currentStreamFormat = null;
      this.stateManager.isPlaying = false;
      if (typeof navigator !== "undefined" && navigator.mediaSession) {
        navigator.mediaSession.playbackState = "paused";
      }
      this.sendStateUpdate();
    }
  }
  // Handle server commands
  handleServerCommand(message) {
    const playerCommand = message.payload.player;
    if (!playerCommand)
      return;
    switch (playerCommand.command) {
      case "volume":
        if (playerCommand.volume !== void 0) {
          this.stateManager.volume = playerCommand.volume;
          this.streamHandler.handleVolumeUpdate();
          if (this.useHardwareVolume && this.onVolumeCommand) {
            this.onVolumeCommand(playerCommand.volume, this.stateManager.muted);
          }
        }
        break;
      case "mute":
        if (playerCommand.mute !== void 0) {
          this.stateManager.muted = playerCommand.mute;
          this.streamHandler.handleVolumeUpdate();
          if (this.useHardwareVolume && this.onVolumeCommand) {
            this.onVolumeCommand(this.stateManager.volume, playerCommand.mute);
          }
        }
        break;
      case "set_static_delay": {
        const delay = playerCommand.static_delay_ms;
        if (typeof delay === "number" && isFinite(delay)) {
          const clamped = clampSyncDelayMs(delay);
          this.streamHandler.handleSyncDelayChange(clamped);
          this.onDelayCommand?.(clamped);
        }
        break;
      }
    }
    this.restartStateUpdateInterval();
    this.sendStateUpdate(true);
  }
  // Send client hello with player identification
  sendClientHello() {
    const hello = {
      type: "client/hello",
      payload: {
        client_id: this.playerId,
        name: this.clientName,
        version: 1,
        supported_roles: ["player@v1", "controller@v1", "metadata@v1"],
        device_info: {
          product_name: "Web Browser",
          manufacturer: typeof navigator !== "undefined" && navigator.vendor || "Unknown",
          software_version: typeof navigator !== "undefined" && navigator.userAgent || "Unknown"
        },
        "player@v1_support": {
          supported_formats: getSupportedFormats(this.codecs),
          buffer_capacity: this.bufferCapacity,
          supported_commands: ["volume", "mute"]
        }
      }
    };
    this.wsManager.send(hello);
  }
  setRequiredLeadTimeMs(leadTimeMs) {
    assertBufferMs(leadTimeMs, "requiredLeadTimeMs");
    this.requiredLeadTimeMs = leadTimeMs;
    this.sendStateUpdate();
  }
  setMinBufferMs(minBufferMs) {
    assertBufferMs(minBufferMs, "minBufferMs");
    this.minBufferMs = minBufferMs;
    this.sendStateUpdate();
  }
  // Send state update
  // When skipHardwareRead is true, use stateManager values instead of reading from hardware.
  // This avoids race conditions when responding to volume commands.
  sendStateUpdate(skipHardwareRead = false) {
    let volume = this.stateManager.volume;
    let muted = this.stateManager.muted;
    if (!skipHardwareRead && this.useHardwareVolume && this.getExternalVolume) {
      const externalVol = this.getExternalVolume();
      volume = externalVol.volume;
      muted = externalVol.muted;
    }
    const syncDelayMs = this.streamHandler.getSyncDelayMs();
    const staticDelayMs = clampSyncDelayMs(syncDelayMs);
    const message = {
      type: "client/state",
      payload: {
        player: {
          state: this.stateManager.playerState,
          volume,
          muted,
          static_delay_ms: staticDelayMs,
          required_lead_time_ms: this.requiredLeadTimeMs,
          min_buffer_ms: this.minBufferMs,
          supported_commands: ["set_static_delay"]
        }
      }
    };
    this.wsManager.send(message);
  }
  // Send goodbye message before disconnecting
  sendGoodbye(reason) {
    this.wsManager.send({
      type: "client/goodbye",
      payload: {
        reason
      }
    });
  }
  // Send controller command to server
  sendCommand(command, params) {
    this.wsManager.send({
      type: "client/command",
      payload: {
        controller: {
          command,
          ...params
        }
      }
    });
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/state-manager.js
function applyDiff(existing, diff) {
  const result = { ...existing };
  for (const key of Object.keys(diff)) {
    const value = diff[key];
    if (value === null) {
      delete result[key];
    } else if (value !== void 0) {
      const existingValue = result[key];
      if (typeof value === "object" && !Array.isArray(value) && typeof existingValue === "object" && existingValue !== null && !Array.isArray(existingValue)) {
        result[key] = applyDiff(existingValue, value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
var StateManager = class {
  constructor(onStateChange) {
    this._volume = 100;
    this._muted = false;
    this._playerState = "synchronized";
    this._isPlaying = false;
    this._currentStreamFormat = null;
    this._streamStartServerTime = 0;
    this._streamStartAudioTime = 0;
    this._streamGeneration = 0;
    this._serverState = {};
    this._groupState = {};
    this.timeSyncInterval = null;
    this.stateUpdateInterval = null;
    this.onStateChangeCallback = onStateChange;
  }
  // Volume & Mute
  get volume() {
    return this._volume;
  }
  set volume(value) {
    this._volume = Math.max(0, Math.min(100, value));
    this.notifyStateChange();
  }
  get muted() {
    return this._muted;
  }
  set muted(value) {
    this._muted = value;
    this.notifyStateChange();
  }
  // Player State
  get playerState() {
    return this._playerState;
  }
  set playerState(value) {
    this._playerState = value;
    this.notifyStateChange();
  }
  // Playing State
  get isPlaying() {
    return this._isPlaying;
  }
  set isPlaying(value) {
    this._isPlaying = value;
    this.notifyStateChange();
  }
  // Stream Format
  get currentStreamFormat() {
    return this._currentStreamFormat;
  }
  set currentStreamFormat(value) {
    this._currentStreamFormat = value;
  }
  // Stream Anchoring (for timestamp-based scheduling)
  get streamStartServerTime() {
    return this._streamStartServerTime;
  }
  set streamStartServerTime(value) {
    this._streamStartServerTime = value;
  }
  get streamStartAudioTime() {
    return this._streamStartAudioTime;
  }
  set streamStartAudioTime(value) {
    this._streamStartAudioTime = value;
  }
  // Reset stream anchors (called on stream start)
  resetStreamAnchors() {
    this._streamStartServerTime = 0;
    this._streamStartAudioTime = 0;
    this._streamGeneration++;
  }
  // Get current stream generation
  get streamGeneration() {
    return this._streamGeneration;
  }
  // Interval management
  setTimeSyncInterval(interval) {
    this.clearTimeSyncInterval();
    this.timeSyncInterval = interval;
  }
  clearTimeSyncInterval() {
    if (this.timeSyncInterval !== null) {
      clearTimeout(this.timeSyncInterval);
      this.timeSyncInterval = null;
    }
  }
  setStateUpdateInterval(interval) {
    this.clearStateUpdateInterval();
    this.stateUpdateInterval = interval;
  }
  clearStateUpdateInterval() {
    if (this.stateUpdateInterval !== null) {
      clearInterval(this.stateUpdateInterval);
      this.stateUpdateInterval = null;
    }
  }
  clearAllIntervals() {
    this.clearTimeSyncInterval();
    this.clearStateUpdateInterval();
  }
  // Reset all state (called on disconnect)
  reset() {
    this._volume = 100;
    this._muted = false;
    this._playerState = "synchronized";
    this._isPlaying = false;
    this._currentStreamFormat = null;
    this._streamStartServerTime = 0;
    this._streamStartAudioTime = 0;
    this._serverState = {};
    this._groupState = {};
    this.clearAllIntervals();
  }
  // Notify callback of state changes
  notifyStateChange() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        isPlaying: this._isPlaying,
        volume: this._volume,
        muted: this._muted,
        playerState: this._playerState,
        serverState: this._serverState,
        groupState: this._groupState
      });
    }
  }
  // Update server state (merges delta, null clears fields)
  updateServerState(update) {
    this._serverState = applyDiff(this._serverState, update);
    this.notifyStateChange();
  }
  // Update group state (merges delta, null clears fields)
  updateGroupState(update) {
    this._groupState = applyDiff(this._groupState, update);
    this.notifyStateChange();
  }
  // Getters for cached state
  get serverState() {
    return this._serverState;
  }
  get groupState() {
    return this._groupState;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/websocket-manager.js
var WebSocketManager = class {
  constructor(config) {
    this.ws = null;
    this.reconnectTimeout = null;
    this.shouldReconnect = false;
    this.isReconnecting = false;
    this.reconnectAttempt = 0;
    this.baseDelayMs = Math.max(0, config?.baseDelayMs ?? 1e3);
    this.maxDelayMs = Math.max(this.baseDelayMs, config?.maxDelayMs ?? 15e3);
    this.maxAttempts = config?.maxAttempts === void 0 ? Infinity : Math.max(0, config.maxAttempts);
    this.onReconnecting = config?.onReconnecting;
    this.onReconnected = config?.onReconnected;
    this.onExhausted = config?.onExhausted;
  }
  /**
   * Adopt an existing WebSocket connection.
   * The caller is responsible for having already opened the socket.
   * Reconnection is disabled for adopted sockets.
   *
   * Returns a Promise that resolves once the adopted socket is open. Throws
   * synchronously if the socket is already CLOSING or CLOSED.
   */
  adopt(ws, onOpen, onMessage, onError, onClose) {
    if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
      throw new Error(`Sendspin: Cannot adopt WebSocket in readyState ${ws.readyState} (must be OPEN or CONNECTING)`);
    }
    this.onOpenHandler = onOpen;
    this.onMessageHandler = onMessage;
    this.onErrorHandler = onError;
    this.onCloseHandler = onClose;
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      old.close();
      this.ws = null;
    }
    this.ws = ws;
    this.ws.binaryType = "arraybuffer";
    this.shouldReconnect = false;
    this.clearReconnectState();
    this.ws.onmessage = (event) => {
      if (this.onMessageHandler) {
        this.onMessageHandler(event);
      }
    };
    this.ws.onerror = (error) => {
      console.error("Sendspin: WebSocket error", error);
      if (this.onErrorHandler) {
        this.onErrorHandler(error);
      }
    };
    this.ws.onclose = () => {
      console.log("Sendspin: WebSocket disconnected");
      if (this.onCloseHandler) {
        this.onCloseHandler();
      }
    };
    return new Promise((resolve, reject) => {
      const fireOpen = () => {
        if (this.onOpenHandler) {
          this.onOpenHandler();
        }
        resolve();
      };
      if (ws.readyState === WebSocket.OPEN) {
        console.log("Sendspin: Adopted open WebSocket");
        fireOpen();
        return;
      }
      const prevOnClose = this.ws.onclose;
      this.ws.onopen = () => {
        console.log("Sendspin: Adopted WebSocket connected");
        fireOpen();
      };
      this.ws.onclose = (event) => {
        if (prevOnClose) {
          prevOnClose.call(this.ws, event);
        }
        reject(new Error("Sendspin: Adopted WebSocket closed before opening"));
      };
    });
  }
  // Connect to WebSocket server
  async connect(url, onOpen, onMessage, onError, onClose) {
    this.onOpenHandler = onOpen;
    this.onMessageHandler = onMessage;
    this.onErrorHandler = onError;
    this.onCloseHandler = onClose;
    this.shouldReconnect = false;
    this.clearReconnectState();
    if (this.ws) {
      const old = this.ws;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      old.close();
      this.ws = null;
    }
    return this.openSocket(url);
  }
  openSocket(url) {
    return new Promise((resolve, reject) => {
      try {
        console.log("Sendspin: Connecting to", url);
        this.ws = new WebSocket(url);
        this.ws.binaryType = "arraybuffer";
        this.shouldReconnect = true;
        this.ws.onopen = () => {
          console.log("Sendspin: WebSocket connected");
          const wasReconnecting = this.isReconnecting;
          this.isReconnecting = false;
          this.reconnectAttempt = 0;
          if (this.onOpenHandler) {
            this.onOpenHandler();
          }
          if (wasReconnecting) {
            this.onReconnected?.();
          }
          resolve();
        };
        this.ws.onmessage = (event) => {
          if (this.onMessageHandler) {
            this.onMessageHandler(event);
          }
        };
        this.ws.onerror = (error) => {
          console.error("Sendspin: WebSocket error", error);
          if (this.onErrorHandler) {
            this.onErrorHandler(error);
          }
          reject(error);
        };
        this.ws.onclose = () => {
          console.log("Sendspin: WebSocket disconnected");
          if (this.onCloseHandler) {
            this.onCloseHandler();
          }
          if (this.shouldReconnect) {
            this.scheduleReconnect(url);
          }
        };
      } catch (error) {
        console.error("Sendspin: Failed to connect", error);
        reject(error);
      }
    });
  }
  getReconnectDelayMs(attempt) {
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    return Math.min(exponential, this.maxDelayMs);
  }
  // Schedule reconnection attempt
  scheduleReconnect(url) {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const attempt = this.reconnectAttempt + 1;
    if (attempt > this.maxAttempts) {
      console.warn(`Sendspin: Reconnect exhausted after ${this.maxAttempts} attempt(s)`);
      this.shouldReconnect = false;
      this.isReconnecting = false;
      this.reconnectAttempt = 0;
      this.onExhausted?.();
      return;
    }
    this.reconnectAttempt = attempt;
    this.isReconnecting = true;
    const delayMs = this.getReconnectDelayMs(attempt);
    this.reconnectTimeout = globalThis.setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.shouldReconnect) {
        return;
      }
      this.onReconnecting?.(attempt);
      console.log(`Sendspin: Attempting to reconnect (attempt ${attempt}${this.maxAttempts === Infinity ? "" : `/${this.maxAttempts}`})...`);
      this.openSocket(url).catch((error) => {
        console.error("Sendspin: Reconnection failed", error);
      });
    }, delayMs);
  }
  clearReconnectState() {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempt = 0;
  }
  // Disconnect from WebSocket server
  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectState();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  // Send message to server (JSON)
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("Sendspin: Cannot send message, WebSocket not connected");
    }
  }
  // Check if WebSocket is connected
  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  // Get current ready state
  getReadyState() {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/time-filter.js
var ADAPTIVE_FORGETTING_CUTOFF = 2;
var SendspinTimeFilter = class {
  constructor(offset_process_std_dev = 0.01, forget_factor = 1.1, drift_significance_threshold = 2, drift_process_std_dev = 0) {
    this._last_update = 0;
    this._count = 0;
    this._offset = 0;
    this._drift = 0;
    this._offset_covariance = Infinity;
    this._offset_drift_covariance = 0;
    this._drift_covariance = 0;
    this._use_drift = false;
    this._offset_process_variance = offset_process_std_dev * offset_process_std_dev;
    this._drift_process_variance = drift_process_std_dev * drift_process_std_dev;
    this._forget_variance_factor = forget_factor * forget_factor;
    this._drift_significance_threshold_squared = drift_significance_threshold * drift_significance_threshold;
    this._current_time_element = this._createDefaultTimeElement();
  }
  /**
   * Create a default TimeElement with zero values.
   * Single source of truth for default initialization.
   */
  _createDefaultTimeElement() {
    return {
      last_update: 0,
      offset: 0,
      drift: 0
    };
  }
  /**
   * Process a new time synchronization measurement through the Kalman filter.
   *
   * Updates the filter's offset and drift estimates using a two-stage Kalman filter
   * algorithm: predict based on the drift model then correct using the new
   * measurement. The measurement uncertainty is derived from the network round-trip
   * delay.
   *
   * @param measurement - Computed offset from NTP-style exchange: ((T2-T1)+(T3-T4))/2 in microseconds
   * @param max_error - Half the round-trip delay: ((T4-T1)-(T3-T2))/2, representing maximum measurement uncertainty in microseconds
   * @param time_added - Client timestamp when this measurement was taken in microseconds
   */
  update(measurement, max_error, time_added) {
    if (time_added <= this._last_update) {
      return;
    }
    const dt = time_added - this._last_update;
    this._last_update = time_added;
    const update_std_dev = max_error;
    const measurement_variance = update_std_dev * update_std_dev;
    if (this._count <= 0) {
      this._count += 1;
      this._offset = measurement;
      this._offset_covariance = measurement_variance;
      this._drift = 0;
      this._current_time_element = {
        last_update: this._last_update,
        offset: this._offset,
        drift: this._drift
      };
      this._use_drift = false;
      return;
    }
    if (this._count === 1) {
      this._count += 1;
      this._drift = (measurement - this._offset) / dt;
      this._offset = measurement;
      this._drift_covariance = (this._offset_covariance + measurement_variance) / (dt * dt);
      this._offset_covariance = measurement_variance;
      this._current_time_element = {
        last_update: this._last_update,
        offset: this._offset,
        drift: this._drift
      };
      this._use_drift = false;
      return;
    }
    const offset = this._offset + this._drift * dt;
    const dt_squared = dt * dt;
    const drift_process_variance = dt * this._drift_process_variance;
    let new_drift_covariance = this._drift_covariance + drift_process_variance;
    const offset_drift_process_variance = 0;
    let new_offset_drift_covariance = this._offset_drift_covariance + this._drift_covariance * dt + offset_drift_process_variance;
    const offset_process_variance = dt * this._offset_process_variance;
    let new_offset_covariance = this._offset_covariance + 2 * this._offset_drift_covariance * dt + this._drift_covariance * dt_squared + offset_process_variance;
    const residual = measurement - offset;
    const max_residual_cutoff = max_error * ADAPTIVE_FORGETTING_CUTOFF;
    if (this._count < 100) {
      this._count += 1;
    } else if (Math.abs(residual) > max_residual_cutoff) {
      new_drift_covariance *= this._forget_variance_factor;
      new_offset_drift_covariance *= this._forget_variance_factor;
      new_offset_covariance *= this._forget_variance_factor;
    }
    const uncertainty = 1 / (new_offset_covariance + measurement_variance);
    const offset_gain = new_offset_covariance * uncertainty;
    const drift_gain = new_offset_drift_covariance * uncertainty;
    this._offset = offset + offset_gain * residual;
    this._drift += drift_gain * residual;
    this._drift_covariance = new_drift_covariance - drift_gain * new_offset_drift_covariance;
    this._offset_drift_covariance = new_offset_drift_covariance - drift_gain * new_offset_covariance;
    this._offset_covariance = new_offset_covariance - offset_gain * new_offset_covariance;
    const drift_squared = this._drift * this._drift;
    this._use_drift = drift_squared > this._drift_significance_threshold_squared * this._drift_covariance;
    this._current_time_element = {
      last_update: this._last_update,
      offset: this._offset,
      drift: this._drift
    };
  }
  /**
   * Convert a client timestamp to the equivalent server timestamp.
   *
   * Applies the current offset and drift compensation to transform from client time
   * domain to server time domain. The transformation accounts for both static offset
   * and dynamic drift accumulated since the last filter update.
   *
   * @param client_time - Client timestamp in microseconds
   * @returns Equivalent server timestamp in microseconds
   */
  computeServerTime(client_time) {
    const dt = client_time - this._current_time_element.last_update;
    const effective_drift = this._use_drift ? this._current_time_element.drift : 0;
    const offset = Math.round(this._current_time_element.offset + effective_drift * dt);
    return client_time + offset;
  }
  /**
   * Convert a server timestamp to the equivalent client timestamp.
   *
   * Inverts the time transformation to convert from server time domain to client
   * time domain. Accounts for both offset and drift effects in the inverse
   * transformation.
   *
   * @param server_time - Server timestamp in microseconds
   * @returns Equivalent client timestamp in microseconds
   */
  computeClientTime(server_time) {
    const effective_drift = this._use_drift ? this._current_time_element.drift : 0;
    return Math.round((server_time - this._current_time_element.offset + effective_drift * this._current_time_element.last_update) / (1 + effective_drift));
  }
  /**
   * Reset the filter state.
   */
  reset() {
    this._count = 0;
    this._last_update = 0;
    this._offset = 0;
    this._drift = 0;
    this._offset_covariance = Infinity;
    this._offset_drift_covariance = 0;
    this._drift_covariance = 0;
    this._use_drift = false;
    this._current_time_element = this._createDefaultTimeElement();
  }
  /**
   * Get the number of time sync measurements processed.
   */
  get count() {
    return this._count;
  }
  /**
   * Check if time synchronization is ready for use.
   *
   * Time sync is considered ready when at least 1 measurement has been
   * collected and the offset covariance is finite (not infinite).
   */
  get is_synchronized() {
    return this._count >= 1 && isFinite(this._offset_covariance);
  }
  /**
   * Get the standard deviation estimate in microseconds.
   */
  get error() {
    return Math.round(Math.sqrt(this._offset_covariance));
  }
  /**
   * Get the covariance (variance) estimate for the offset.
   */
  get covariance() {
    return Math.round(this._offset_covariance);
  }
  /**
   * Get the current filtered offset estimate in microseconds.
   */
  get offset() {
    return this._offset;
  }
  /**
   * Get the current clock drift rate estimate.
   * Returns the drift as a ratio (e.g., 0.04 means server clock is 4% faster).
   */
  get drift() {
    return this._drift;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/static-delay-store.js
var STATIC_DELAY_STORAGE_KEY = "sendspin-static-delay-ms";
var StaticDelayStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  load() {
    if (!this.storage)
      return null;
    try {
      const stored = this.storage.getItem(STATIC_DELAY_STORAGE_KEY);
      if (stored === null)
        return null;
      const value = parseFloat(stored);
      if (isNaN(value))
        return null;
      return clampSyncDelayMs(value);
    } catch {
      return null;
    }
  }
  save(delayMs) {
    if (!this.storage)
      return;
    try {
      this.storage.setItem(STATIC_DELAY_STORAGE_KEY, delayMs.toString());
    } catch {
    }
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/core/core.js
function generateRandomId() {
  return Math.random().toString(36).substring(2, 6);
}
var SendspinCore = class {
  constructor(config) {
    const randomId = generateRandomId();
    const playerId = config.playerId ?? `sendspin-js-${randomId}`;
    const clientName = config.clientName ?? `Sendspin JS Client (${randomId})`;
    this.config = { ...config, playerId, clientName };
    this.delayStore = new StaticDelayStore(config.storage ?? null);
    const persisted = this.delayStore.load();
    const initialDelay = config.syncDelay ?? persisted ?? config.defaultSyncDelay ?? 0;
    this._syncDelayMs = clampSyncDelayMs(initialDelay);
    this.timeFilter = new SendspinTimeFilter(0, 1.1, 2, 1e-12);
    this.stateManager = new StateManager(config.onStateChange);
    this.decoder = new SendspinDecoder((chunk) => this._onAudioData?.(chunk), () => this.stateManager.streamGeneration);
    this.wsManager = new WebSocketManager(config.reconnect);
    this.protocolHandler = new ProtocolHandler(
      playerId,
      this.wsManager,
      this,
      // this class implements StreamHandler
      this.stateManager,
      this.timeFilter,
      {
        clientName,
        codecs: config.codecs,
        bufferCapacity: config.bufferCapacity,
        requiredLeadTimeMs: config.requiredLeadTimeMs,
        minBufferMs: config.minBufferMs,
        useHardwareVolume: config.useHardwareVolume,
        onVolumeCommand: config.onVolumeCommand,
        onDelayCommand: config.onDelayCommand,
        getExternalVolume: config.getExternalVolume
      }
    );
  }
  // ========================================
  // StreamHandler implementation
  // (called by ProtocolHandler)
  // ========================================
  handleBinaryMessage(data) {
    const format = this.stateManager.currentStreamFormat;
    if (!format) {
      console.warn("Sendspin: Received audio chunk but no stream format set");
      return;
    }
    const generation = this.stateManager.streamGeneration;
    this.decoder.handleBinaryMessage(data, format, generation);
  }
  handleStreamStart(format, isFormatUpdate) {
    if (!isFormatUpdate) {
      this.decoder.clearState();
    }
    this._onStreamStart?.(format, isFormatUpdate);
  }
  handleStreamClear() {
    this.decoder.clearState();
    this._onStreamClear?.();
  }
  handleStreamEnd() {
    this.decoder.clearState();
    this._onStreamEnd?.();
  }
  handleVolumeUpdate() {
    this._onVolumeUpdate?.();
  }
  applyDelay(delayMs) {
    this._syncDelayMs = clampSyncDelayMs(delayMs);
    this.delayStore.save(this._syncDelayMs);
    this._onSyncDelayChange?.(this._syncDelayMs);
  }
  handleSyncDelayChange(delayMs) {
    this.applyDelay(delayMs);
  }
  getSyncDelayMs() {
    return this._syncDelayMs;
  }
  // ========================================
  // Event registration
  // ========================================
  set onAudioData(cb) {
    this._onAudioData = cb;
  }
  set onStreamStart(cb) {
    this._onStreamStart = cb;
  }
  set onStreamClear(cb) {
    this._onStreamClear = cb;
  }
  set onStreamEnd(cb) {
    this._onStreamEnd = cb;
  }
  set onVolumeUpdate(cb) {
    this._onVolumeUpdate = cb;
  }
  set onSyncDelayChange(cb) {
    this._onSyncDelayChange = cb;
  }
  set onConnectionOpen(cb) {
    this._onConnectionOpen = cb;
  }
  set onConnectionClose(cb) {
    this._onConnectionClose = cb;
  }
  // ========================================
  // Connection
  // ========================================
  async connect() {
    const onOpen = () => {
      this._onConnectionOpen?.();
      console.log("Sendspin: Using player_id:", this.config.playerId);
      this.protocolHandler.sendClientHello();
    };
    const onMessage = (event) => {
      this.protocolHandler.handleMessage(event);
    };
    const onError = (error) => {
      console.error("Sendspin: WebSocket error", error);
    };
    const onClose = () => {
      this.protocolHandler.stopTimeSync();
      this.stateManager.clearStateUpdateInterval();
      console.log("Sendspin: Connection closed");
      this._onConnectionClose?.();
    };
    if (this.config.webSocket) {
      await this.wsManager.adopt(this.config.webSocket, onOpen, onMessage, onError, onClose);
    } else {
      if (!this.config.baseUrl) {
        throw new Error("SendspinCore requires either baseUrl or webSocket to be provided.");
      }
      const url = new URL(this.config.baseUrl, typeof window !== "undefined" ? window.location.href : void 0);
      const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
      const basePath = url.pathname.replace(/\/$/, "");
      const wsUrl = basePath.endsWith("/sendspin") ? `${wsProtocol}//${url.host}${basePath}` : `${wsProtocol}//${url.host}${basePath}/sendspin`;
      await this.wsManager.connect(wsUrl, onOpen, onMessage, onError, onClose);
    }
  }
  /**
   * Reset playback-related state (isPlaying, currentStreamFormat) without
   * tearing down the connection. Intended for transport-loss cleanup after
   * any buffered audio has finished draining.
   */
  resetPlaybackState() {
    this.stateManager.isPlaying = false;
    this.stateManager.currentStreamFormat = null;
  }
  disconnect(reason = "restart") {
    if (this.wsManager.isConnected()) {
      this.protocolHandler.sendGoodbye(reason);
    }
    this.protocolHandler.stopTimeSync();
    this.stateManager.clearAllIntervals();
    this.wsManager.disconnect();
    this.decoder.close();
    this.timeFilter.reset();
    this.stateManager.reset();
  }
  // ========================================
  // Volume / Mute
  // ========================================
  setVolume(volume) {
    this.stateManager.volume = volume;
    this._onVolumeUpdate?.();
    this.protocolHandler.sendStateUpdate();
  }
  setMuted(muted) {
    this.stateManager.muted = muted;
    this._onVolumeUpdate?.();
    this.protocolHandler.sendStateUpdate();
  }
  // ========================================
  // Sync delay
  // ========================================
  setSyncDelay(delayMs) {
    this.applyDelay(delayMs);
    this.protocolHandler.sendStateUpdate();
  }
  // ========================================
  // Buffer timing
  // ========================================
  setRequiredLeadTimeMs(leadTimeMs) {
    this.protocolHandler.setRequiredLeadTimeMs(leadTimeMs);
  }
  setMinBufferMs(minBufferMs) {
    this.protocolHandler.setMinBufferMs(minBufferMs);
  }
  // ========================================
  // Controller commands
  // ========================================
  sendCommand(command, params) {
    const supportedCommands = this.stateManager.serverState.controller?.supported_commands;
    if (supportedCommands && !supportedCommands.includes(command)) {
      throw new Error(`Command '${command}' is not supported by the server. Supported commands: ${supportedCommands.join(", ")}`);
    }
    this.protocolHandler.sendCommand(command, params);
  }
  // ========================================
  // State getters
  // ========================================
  get isPlaying() {
    return this.stateManager.isPlaying;
  }
  get volume() {
    return this.stateManager.volume;
  }
  get muted() {
    return this.stateManager.muted;
  }
  get playerState() {
    return this.stateManager.playerState;
  }
  get currentFormat() {
    return this.stateManager.currentStreamFormat;
  }
  get isConnected() {
    return this.wsManager.isConnected();
  }
  get timeSyncInfo() {
    return {
      synced: this.timeFilter.is_synchronized,
      offset: Math.round(this.timeFilter.offset / 1e3),
      error: Math.round(this.timeFilter.error / 1e3)
    };
  }
  getCurrentServerTimeUs() {
    return this.timeFilter.computeServerTime(Math.floor(performance.now() * 1e3));
  }
  get trackProgress() {
    const metadata = this.stateManager.serverState.metadata;
    if (!metadata?.progress || metadata.timestamp === void 0) {
      return null;
    }
    const serverTimeUs = this.getCurrentServerTimeUs();
    const elapsedUs = serverTimeUs - metadata.timestamp;
    const positionMs = metadata.progress.track_progress + elapsedUs * metadata.progress.playback_speed / 1e6;
    const trackDuration = metadata.progress.track_duration;
    return {
      // track_duration 0 means unbounded (live radio), so floor at 0 only.
      positionMs: trackDuration === 0 ? Math.max(0, positionMs) : Math.max(0, Math.min(positionMs, trackDuration)),
      durationMs: trackDuration,
      playbackSpeed: metadata.progress.playback_speed / 1e3
    };
  }
  // ========================================
  // Internal accessors (for SendspinPlayer)
  // ========================================
  /** @internal */
  get _stateManager() {
    return this.stateManager;
  }
  /** @internal */
  get _timeFilter() {
    return this.timeFilter;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/audio/clock-source.js
var OUTPUT_TIMESTAMP_MAX_FRESHNESS_MS = 250;
var OUTPUT_TIMESTAMP_MIN_SAMPLE_INTERVAL_MS = 40;
var OUTPUT_TIMESTAMP_SLOPE_MIN = 0.95;
var OUTPUT_TIMESTAMP_SLOPE_MAX = 1.05;
var OUTPUT_TIMESTAMP_MAX_DIVERGENCE_SEC = 0.25;
var OUTPUT_TIMESTAMP_MAX_DIVERGENCE_DELTA_SEC = 0.05;
var OUTPUT_TIMESTAMP_MAX_BACKWARD_SEC = 5e-3;
var OUTPUT_TIMESTAMP_FUTURE_TOLERANCE_MS = 5;
var OUTPUT_TIMESTAMP_PROMOTION_MIN_GOOD_SAMPLES = 6;
var OUTPUT_TIMESTAMP_PROMOTION_MIN_SPAN_MS = 750;
var OUTPUT_TIMESTAMP_MAX_CONSECUTIVE_BAD_SAMPLES = 2;
var TIMING_MAX_SLEW_SEC = 2e-3;
var TIMING_RESET_THRESHOLD_SEC = 0.5;
var TIMING_MAX_LEAD_SEC = 0.1;
var ClockSource = class {
  constructor() {
    this.activeSource = "estimated";
    this._pendingCutover = false;
    this._lastRejectReason = null;
    this._timestampPromotionDisabled = false;
    this.lastSample = null;
    this.goodSamples = 0;
    this.badSamples = 0;
    this.goodSinceMs = null;
    this.estimateAudioTimeSec = null;
    this.estimateAtMs = null;
  }
  get active() {
    return this.activeSource;
  }
  get pendingCutover() {
    return this._pendingCutover;
  }
  set pendingCutover(value) {
    this._pendingCutover = value;
  }
  get lastRejectReason() {
    return this._lastRejectReason;
  }
  get timestampGoodSamples() {
    return this.goodSamples;
  }
  get timestampPromotionDisabled() {
    return this._timestampPromotionDisabled;
  }
  /** Disable timestamp promotion (e.g., on Cast receivers to avoid rate oscillations). */
  disableTimestampPromotion() {
    this._timestampPromotionDisabled = true;
  }
  setActive(source) {
    if (this.activeSource === source)
      return false;
    this.activeSource = source;
    this._pendingCutover = source === "timestamp";
    if (this._pendingCutover) {
      this._onPromotion?.();
    }
    return this._pendingCutover;
  }
  onPromotion(cb) {
    this._onPromotion = cb;
  }
  reset() {
    this.activeSource = "estimated";
    this._pendingCutover = false;
    this.lastSample = null;
    this.goodSamples = 0;
    this._lastRejectReason = null;
    this.badSamples = 0;
    this.goodSinceMs = null;
    this.estimateAudioTimeSec = null;
    this.estimateAtMs = null;
  }
  demote(reason) {
    this.reset();
    this._lastRejectReason = reason;
  }
  rejectSample(reason, catastrophic = false) {
    this.lastSample = null;
    this.goodSamples = 0;
    this.goodSinceMs = null;
    this._lastRejectReason = reason;
    if (this.activeSource !== "timestamp") {
      this.badSamples = 0;
      return;
    }
    this.badSamples += 1;
    if (catastrophic || this.badSamples >= OUTPUT_TIMESTAMP_MAX_CONSECUTIVE_BAD_SAMPLES) {
      this.demote(reason);
    }
  }
  getEstimatedTime(rawTimeSec, nowMs) {
    if (this.estimateAudioTimeSec === null) {
      this.estimateAudioTimeSec = rawTimeSec;
      this.estimateAtMs = nowMs;
    } else if (this.estimateAtMs !== null) {
      const wallDeltaSec = Math.max(0, (nowMs - this.estimateAtMs) / 1e3);
      const predicted = this.estimateAudioTimeSec + wallDeltaSec;
      this.estimateAtMs = nowMs;
      const errorSec = rawTimeSec - predicted;
      if (Math.abs(errorSec) > TIMING_RESET_THRESHOLD_SEC) {
        this.estimateAudioTimeSec = rawTimeSec;
      } else {
        const slew = Math.max(-TIMING_MAX_SLEW_SEC, Math.min(TIMING_MAX_SLEW_SEC, errorSec));
        const next = Math.max(this.estimateAudioTimeSec, predicted + slew);
        this.estimateAudioTimeSec = Math.min(next, rawTimeSec + TIMING_MAX_LEAD_SEC);
      }
    }
    return this.estimateAudioTimeSec ?? rawTimeSec;
  }
  getTimestampDerivedTime(rawTimeSec, audioContext) {
    if (this._timestampPromotionDisabled) {
      if (this.activeSource !== "estimated" || this.lastSample !== null || this.goodSamples !== 0 || this._lastRejectReason !== null) {
        this.reset();
      }
      return null;
    }
    const getOutputTimestamp = audioContext.getOutputTimestamp;
    if (typeof getOutputTimestamp !== "function") {
      if (this.activeSource === "timestamp") {
        this.demote("getOutputTimestamp unavailable");
      }
      return null;
    }
    try {
      const ts = getOutputTimestamp.call(audioContext);
      const nowMs = performance.now();
      const rawFreshnessMs = nowMs - ts.performanceTime;
      if (rawFreshnessMs < -OUTPUT_TIMESTAMP_FUTURE_TOLERANCE_MS) {
        this.rejectSample(`performanceTime in future (${rawFreshnessMs.toFixed(1)}ms)`, true);
        return null;
      }
      const freshnessMs = Math.max(0, rawFreshnessMs);
      const predictedAudioTimeSec = ts.contextTime + freshnessMs / 1e3;
      const sample = {
        contextTimeSec: ts.contextTime,
        performanceTimeMs: ts.performanceTime,
        nowMs,
        predictedAudioTimeSec,
        rawAudioTimeSec: rawTimeSec
      };
      if (freshnessMs > OUTPUT_TIMESTAMP_MAX_FRESHNESS_MS) {
        this.rejectSample(`stale timestamp (${freshnessMs.toFixed(1)}ms old)`, true);
        return null;
      }
      const divergenceSec = predictedAudioTimeSec - rawTimeSec;
      if (Math.abs(divergenceSec) > OUTPUT_TIMESTAMP_MAX_DIVERGENCE_SEC) {
        this.rejectSample(`timestamp/raw divergence ${Math.abs(divergenceSec * 1e3).toFixed(1)}ms`, true);
        return null;
      }
      const prev = this.lastSample;
      if (prev) {
        const perfDeltaMs = ts.performanceTime - prev.performanceTimeMs;
        if (perfDeltaMs < 0) {
          this.rejectSample(`performanceTime moved backward (${perfDeltaMs.toFixed(1)}ms)`, true);
          return null;
        }
        if (predictedAudioTimeSec < prev.predictedAudioTimeSec - OUTPUT_TIMESTAMP_MAX_BACKWARD_SEC) {
          this.rejectSample(`predicted audio time moved backward ${((prev.predictedAudioTimeSec - predictedAudioTimeSec) * 1e3).toFixed(1)}ms`, true);
          return null;
        }
        const prevDivergenceSec = prev.predictedAudioTimeSec - prev.rawAudioTimeSec;
        if (Math.abs(divergenceSec - prevDivergenceSec) > OUTPUT_TIMESTAMP_MAX_DIVERGENCE_DELTA_SEC) {
          this.rejectSample(`timestamp/raw divergence drift ${Math.abs((divergenceSec - prevDivergenceSec) * 1e3).toFixed(1)}ms`);
          return null;
        }
        if (perfDeltaMs >= OUTPUT_TIMESTAMP_MIN_SAMPLE_INTERVAL_MS) {
          const perfDeltaSec = perfDeltaMs / 1e3;
          const contextSlope = (ts.contextTime - prev.contextTimeSec) / perfDeltaSec;
          const predictedSlope = (predictedAudioTimeSec - prev.predictedAudioTimeSec) / perfDeltaSec;
          if (contextSlope < OUTPUT_TIMESTAMP_SLOPE_MIN || contextSlope > OUTPUT_TIMESTAMP_SLOPE_MAX) {
            this.rejectSample(`context slope ${contextSlope.toFixed(3)} out of range`);
            return null;
          }
          if (predictedSlope < OUTPUT_TIMESTAMP_SLOPE_MIN || predictedSlope > OUTPUT_TIMESTAMP_SLOPE_MAX) {
            this.rejectSample(`predicted slope ${predictedSlope.toFixed(3)} out of range`);
            return null;
          }
        }
      }
      this.lastSample = sample;
      this.badSamples = 0;
      if (this.goodSinceMs === null) {
        this.goodSinceMs = nowMs;
      }
      this.goodSamples += 1;
      if (this.activeSource !== "timestamp" && this.goodSamples >= OUTPUT_TIMESTAMP_PROMOTION_MIN_GOOD_SAMPLES && this.goodSinceMs !== null && nowMs - this.goodSinceMs >= OUTPUT_TIMESTAMP_PROMOTION_MIN_SPAN_MS) {
        this.setActive("timestamp");
        this._lastRejectReason = null;
      }
      return predictedAudioTimeSec;
    } catch (error) {
      const reason = error instanceof Error ? `getOutputTimestamp failed: ${error.message}` : `getOutputTimestamp failed: ${String(error)}`;
      this.rejectSample(reason, true);
      return null;
    }
  }
  /** Get a timing snapshot with both derived and raw AudioContext times. */
  getTimingSnapshot(audioContext) {
    const nowMs = performance.now();
    const nowUs = nowMs * 1e3;
    if (!audioContext) {
      return {
        audioContextTimeSec: 0,
        audioContextRawTimeSec: 0,
        nowMs,
        nowUs
      };
    }
    const rawTimeSec = audioContext.currentTime;
    const estimatedTimeSec = this.getEstimatedTime(rawTimeSec, nowMs);
    const timestampTimeSec = this.getTimestampDerivedTime(rawTimeSec, audioContext);
    let derivedTimeSec = this.activeSource === "timestamp" && timestampTimeSec !== null ? timestampTimeSec : estimatedTimeSec;
    if (!Number.isFinite(derivedTimeSec)) {
      derivedTimeSec = rawTimeSec;
    }
    return {
      audioContextTimeSec: derivedTimeSec,
      audioContextRawTimeSec: rawTimeSec,
      nowMs,
      nowUs
    };
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/audio/recorrection-monitor.js
var RECORRECTION_CHECK_INTERVAL_MS = 250;
var RECORRECTION_TRIGGER_MS = 30;
var RECORRECTION_SUSTAIN_MS = 400;
var RECORRECTION_COOLDOWN_MS = 1500;
var RECORRECTION_TRANSIENT_JUMP_MS = 25;
var RECORRECTION_TRANSIENT_CONFIRM_WINDOW_MS = RECORRECTION_CHECK_INTERVAL_MS * 4;
var HARD_RESYNC_STARTUP_GRACE_MS = 1e3;
var HARD_RESYNC_COOLDOWN_MS = 500;
var RecorrectionMonitor = class {
  get minScheduleTimeSec() {
    return this._minScheduleTimeSec;
  }
  setMinScheduleTime(timeSec) {
    this._minScheduleTimeSec = timeSec;
  }
  clearMinScheduleTime() {
    this._minScheduleTimeSec = null;
  }
  constructor(onCheck) {
    this.onCheck = onCheck;
    this.interval = null;
    this.breachStartedAtMs = null;
    this.lastRecorrectionAtMs = -Infinity;
    this.prevRawSyncErrorMs = null;
    this.pendingJumpSign = null;
    this.pendingJumpAtMs = null;
    this.transientStartedAtMs = null;
    this._hardResyncGraceUntilMs = null;
    this._lastHardResyncAtMs = -Infinity;
    this._minScheduleTimeSec = null;
  }
  start() {
    if (this.interval !== null)
      return;
    this.interval = globalThis.setInterval(() => this.onCheck(), RECORRECTION_CHECK_INTERVAL_MS);
  }
  stop() {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.resetCheckState();
    this.lastRecorrectionAtMs = -Infinity;
  }
  clearBreachState() {
    this.breachStartedAtMs = null;
    this.pendingJumpSign = null;
    this.pendingJumpAtMs = null;
    this.transientStartedAtMs = null;
  }
  resetCheckState() {
    this.clearBreachState();
    this.prevRawSyncErrorMs = null;
  }
  clearHardResyncCooldown() {
    this._hardResyncGraceUntilMs = null;
    this._lastHardResyncAtMs = -Infinity;
  }
  armStartupGrace(nowMs, isTimestampClock) {
    if (isTimestampClock) {
      this._hardResyncGraceUntilMs = null;
      return;
    }
    if (this._hardResyncGraceUntilMs === null) {
      this._hardResyncGraceUntilMs = nowMs + HARD_RESYNC_STARTUP_GRACE_MS;
    }
  }
  canUseHardResync(nowMs, isTimestampClock) {
    if (isTimestampClock) {
      this._hardResyncGraceUntilMs = null;
    } else if (this._hardResyncGraceUntilMs !== null && nowMs < this._hardResyncGraceUntilMs) {
      return false;
    }
    return nowMs - this._lastHardResyncAtMs >= HARD_RESYNC_COOLDOWN_MS;
  }
  noteHardResync(nowMs) {
    this._lastHardResyncAtMs = nowMs;
  }
  /** Mark a recorrection as having just happened (for cooldown). */
  markRecorrection(nowMs) {
    this.lastRecorrectionAtMs = nowMs;
  }
  shouldIgnoreTransientJump(rawSyncErrorMs, nowMs) {
    const prev = this.prevRawSyncErrorMs;
    this.prevRawSyncErrorMs = rawSyncErrorMs;
    if (prev === null) {
      this.pendingJumpSign = null;
      this.pendingJumpAtMs = null;
      return false;
    }
    const jumpDeltaMs = rawSyncErrorMs - prev;
    const jumpSign = Math.sign(jumpDeltaMs);
    const isJumpDetected = Math.abs(jumpDeltaMs) >= RECORRECTION_TRANSIENT_JUMP_MS;
    if (!isJumpDetected) {
      this.pendingJumpSign = null;
      this.pendingJumpAtMs = null;
      return false;
    }
    const isConfirmed = this.pendingJumpSign === jumpSign && this.pendingJumpAtMs !== null && nowMs - this.pendingJumpAtMs <= RECORRECTION_TRANSIENT_CONFIRM_WINDOW_MS;
    this.pendingJumpSign = jumpSign;
    this.pendingJumpAtMs = nowMs;
    if (isConfirmed) {
      return false;
    }
    return true;
  }
  /**
   * Evaluate whether a recorrection should fire given the current sync state.
   * Returns true if the scheduler should perform a guarded cutover.
   */
  shouldRecorrect(smoothedAbsErrorMs, rawSyncErrorMs, nowMs) {
    const isTransient = this.shouldIgnoreTransientJump(rawSyncErrorMs, nowMs);
    if (smoothedAbsErrorMs < RECORRECTION_TRIGGER_MS) {
      this.clearBreachState();
      return false;
    }
    if (isTransient) {
      if (this.transientStartedAtMs === null) {
        this.transientStartedAtMs = nowMs;
      }
      if (nowMs - this.transientStartedAtMs < RECORRECTION_SUSTAIN_MS) {
        this.breachStartedAtMs = null;
        return false;
      }
      if (this.breachStartedAtMs === null) {
        this.breachStartedAtMs = this.transientStartedAtMs;
      }
    } else {
      this.transientStartedAtMs = null;
    }
    if (this.breachStartedAtMs === null) {
      this.breachStartedAtMs = nowMs;
      return false;
    }
    if (nowMs - this.breachStartedAtMs < RECORRECTION_SUSTAIN_MS) {
      return false;
    }
    if (nowMs - this.lastRecorrectionAtMs < RECORRECTION_COOLDOWN_MS) {
      return false;
    }
    return true;
  }
  /** Full reset (on disconnect or stream clear). */
  fullReset() {
    this.stop();
    this._hardResyncGraceUntilMs = null;
    this._lastHardResyncAtMs = -Infinity;
    this._minScheduleTimeSec = null;
  }
};
var RECORRECTION_CUTOVER_GUARD_SEC = 0.3;

// ../../../../tmp/sendspin-js-3.2.0/dist/audio/output-latency-tracker.js
var OUTPUT_LATENCY_ALPHA = 0.01;
var OUTPUT_LATENCY_STORAGE_KEY = "sendspin-output-latency-us";
var OUTPUT_LATENCY_PERSIST_INTERVAL_MS = 1e4;
var OutputLatencyTracker = class {
  constructor(storage) {
    this.storage = storage;
    this.smoothedOutputLatencyUs = null;
    this.lastLatencyPersistAtMs = null;
    this.loadPersisted();
  }
  loadPersisted() {
    if (!this.storage)
      return;
    try {
      const stored = this.storage.getItem(OUTPUT_LATENCY_STORAGE_KEY);
      if (stored) {
        const latency = parseFloat(stored);
        if (!isNaN(latency) && latency >= 0) {
          this.smoothedOutputLatencyUs = latency;
        }
      }
    } catch {
    }
  }
  persist() {
    if (!this.storage || this.smoothedOutputLatencyUs === null)
      return;
    try {
      this.storage.setItem(OUTPUT_LATENCY_STORAGE_KEY, this.smoothedOutputLatencyUs.toString());
    } catch {
    }
  }
  /** Get raw output latency in microseconds from AudioContext. */
  getRawUs(audioContext) {
    if (!audioContext)
      return 0;
    const baseLatency = audioContext.baseLatency ?? 0;
    const outputLatency = audioContext.outputLatency ?? 0;
    return (baseLatency + outputLatency) * 1e6;
  }
  /** Get EMA-smoothed output latency in microseconds. */
  getSmoothedUs(audioContext) {
    const rawLatencyUs = this.getRawUs(audioContext);
    if (rawLatencyUs <= 0 && this.smoothedOutputLatencyUs !== null) {
      return this.smoothedOutputLatencyUs;
    }
    if (this.smoothedOutputLatencyUs === null) {
      this.smoothedOutputLatencyUs = rawLatencyUs;
    } else {
      this.smoothedOutputLatencyUs = OUTPUT_LATENCY_ALPHA * rawLatencyUs + (1 - OUTPUT_LATENCY_ALPHA) * this.smoothedOutputLatencyUs;
    }
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (this.lastLatencyPersistAtMs === null || nowMs - this.lastLatencyPersistAtMs >= OUTPUT_LATENCY_PERSIST_INTERVAL_MS) {
      this.persist();
      this.lastLatencyPersistAtMs = nowMs;
    }
    return this.smoothedOutputLatencyUs;
  }
  /** Reset smoother (on stream change or audio context recreation). */
  reset() {
    this.smoothedOutputLatencyUs = null;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/audio/scheduler.js
var SAMPLE_CORRECTION_FADE_LEN = 8;
var SAMPLE_CORRECTION_TARGET_BLEND_SUM = 1;
var SAMPLE_CORRECTION_FADE_STRENGTH = Math.min(1, 2 * SAMPLE_CORRECTION_TARGET_BLEND_SUM / SAMPLE_CORRECTION_FADE_LEN);
var SAMPLE_CORRECTION_FADE_ALPHAS = new Float32Array(SAMPLE_CORRECTION_FADE_LEN);
for (let f = 0; f < SAMPLE_CORRECTION_FADE_LEN; f++) {
  SAMPLE_CORRECTION_FADE_ALPHAS[f] = (SAMPLE_CORRECTION_FADE_LEN - f) / (SAMPLE_CORRECTION_FADE_LEN + 1) * SAMPLE_CORRECTION_FADE_STRENGTH;
}
var SYNC_ERROR_ALPHA = 0.1;
var SCHEDULE_HEADROOM_SEC = 0.2;
var SCHEDULE_HORIZON_PRECISE_SEC = 20;
var SCHEDULE_HORIZON_GOOD_SEC = 8;
var SCHEDULE_HORIZON_POOR_SEC = 4;
var CAST_SCHEDULE_HORIZON_SEC = 1.5;
var SCHEDULE_HORIZON_PRECISE_ERROR_MS = 2;
var SCHEDULE_HORIZON_GOOD_ERROR_MS = 8;
var SCHEDULE_REFILL_THRESHOLD_FRACTION = 0.5;
var SCHEDULE_REFILL_MIN_THRESHOLD_SEC = 0.1;
var SCHEDULE_REFILL_MAX_THRESHOLD_SEC = 5;
var VOLUME_RAMP_TIME_CONSTANT_SEC = 0.015;
function perceptualGain(volume) {
  return Math.pow(volume / 100, 1.5);
}
var DEFAULT_CORRECTION_THRESHOLDS = {
  sync: {
    resyncAboveMs: 200,
    rate2AboveMs: 35,
    rate1AboveMs: 8,
    samplesBelowMs: 8,
    deadbandBelowMs: 1,
    enableRecorrectionMonitor: true,
    immediateDelayCutover: true
  },
  quality: {
    resyncAboveMs: 35,
    rate2AboveMs: Infinity,
    rate1AboveMs: Infinity,
    samplesBelowMs: 35,
    deadbandBelowMs: 1,
    enableRecorrectionMonitor: false,
    immediateDelayCutover: false
  },
  "quality-local": {
    resyncAboveMs: 600,
    rate2AboveMs: Infinity,
    rate1AboveMs: Infinity,
    samplesBelowMs: 0,
    deadbandBelowMs: 5,
    enableRecorrectionMonitor: false,
    immediateDelayCutover: false
  }
};
var AudioScheduler = class {
  constructor(options) {
    this.audioContext = null;
    this.gainNode = null;
    this.streamDestination = null;
    this.audioBufferQueue = [];
    this.scheduledSources = [];
    this.nextPlaybackTime = 0;
    this.nextScheduleTime = 0;
    this.lastScheduledServerTime = 0;
    this.currentSyncErrorMs = 0;
    this.smoothedSyncErrorMs = 0;
    this.resyncCount = 0;
    this.currentPlaybackRate = 1;
    this.currentCorrectionMethod = "none";
    this.lastSamplesAdjusted = 0;
    this._correctionMode = "sync";
    this._lastStatusLogMs = 0;
    this._intervalResyncCount = 0;
    this.scheduleTimeout = null;
    this.refillTimeout = null;
    this.queueProcessScheduled = false;
    this.clockSource = new ClockSource();
    this.stateManager = options.stateManager;
    this.timeFilter = options.timeFilter;
    this.outputMode = options.outputMode ?? "direct";
    this.audioElement = options.audioElement;
    this.isAndroid = options.isAndroid ?? false;
    this.isCastRuntime = options.isCastRuntime ?? false;
    this.ownsAudioElement = options.ownsAudioElement ?? false;
    this.silentAudioSrc = options.silentAudioSrc;
    this.syncDelayMs = clampSyncDelayMs(options.syncDelayMs ?? 0);
    this.useHardwareVolume = options.useHardwareVolume ?? false;
    this._correctionMode = options.correctionMode ?? "sync";
    this.useOutputLatencyCompensation = options.useOutputLatencyCompensation ?? true;
    this.correctionThresholds = { ...DEFAULT_CORRECTION_THRESHOLDS };
    const thresholdOverrides = options.correctionThresholds;
    if (thresholdOverrides) {
      for (const mode of Object.keys(thresholdOverrides)) {
        const overrides = thresholdOverrides[mode];
        if (overrides) {
          this.correctionThresholds[mode] = {
            ...DEFAULT_CORRECTION_THRESHOLDS[mode],
            ...overrides
          };
        }
      }
    }
    this.latencyTracker = new OutputLatencyTracker(options.storage ?? null);
    if (this.isCastRuntime) {
      this.clockSource.disableTimestampPromotion();
    }
    this.clockSource.onPromotion(() => {
      if (this.audioBufferQueue.length > 0 || this.scheduledSources.length > 0) {
        this.scheduleQueueProcessing();
      }
    });
    this.recorrectionMonitor = new RecorrectionMonitor(() => this.checkRecorrection());
  }
  get correctionMode() {
    return this._correctionMode;
  }
  setCorrectionMode(mode) {
    this._correctionMode = mode;
    if (!this.correctionThresholds[mode].enableRecorrectionMonitor) {
      this.recorrectionMonitor.stop();
    } else {
      this.recorrectionMonitor.start();
    }
  }
  get usesRecorrectionMonitor() {
    return this.correctionThresholds[this._correctionMode].enableRecorrectionMonitor;
  }
  get usesImmediateDelayCutover() {
    return this.correctionThresholds[this._correctionMode].immediateDelayCutover;
  }
  getTargetScheduledHorizonSec() {
    if (this.isCastRuntime) {
      return CAST_SCHEDULE_HORIZON_SEC;
    }
    const errorMs = this.timeFilter.error / 1e3;
    if (errorMs < SCHEDULE_HORIZON_PRECISE_ERROR_MS)
      return SCHEDULE_HORIZON_PRECISE_SEC;
    if (errorMs <= SCHEDULE_HORIZON_GOOD_ERROR_MS)
      return SCHEDULE_HORIZON_GOOD_SEC;
    return SCHEDULE_HORIZON_POOR_SEC;
  }
  getScheduledAheadSec(currentTimeSec) {
    let farthest = this.nextScheduleTime;
    for (const entry of this.scheduledSources) {
      if (entry.endTime > farthest)
        farthest = entry.endTime;
    }
    return farthest <= 0 ? 0 : Math.max(0, farthest - currentTimeSec);
  }
  resetScheduledPlaybackState(_reason) {
    this.nextPlaybackTime = 0;
    this.nextScheduleTime = 0;
    this.lastScheduledServerTime = 0;
    this.recorrectionMonitor.clearMinScheduleTime();
    this.recorrectionMonitor.clearHardResyncCooldown();
    this.clockSource.pendingCutover = false;
    this.recorrectionMonitor.resetCheckState();
    this.resetSyncErrorEma();
    this.currentSyncErrorMs = 0;
    this.currentPlaybackRate = 1;
    this.currentCorrectionMethod = "none";
    this.lastSamplesAdjusted = 0;
    this._lastStatusLogMs = 0;
    this._intervalResyncCount = 0;
  }
  pruneExpiredScheduledSources(currentTimeSec) {
    if (this.scheduledSources.length === 0)
      return;
    this.scheduledSources = this.scheduledSources.filter((entry) => entry.endTime > currentTimeSec);
    if (this.scheduledSources.length === 0) {
      this.resetScheduledPlaybackState("no scheduled audio ahead");
    }
  }
  performGuardedCutover(_reason, options = {}) {
    if (!this.audioContext)
      return;
    const incrementResyncCount = options.incrementResyncCount ?? false;
    const markCooldown = options.markCooldown ?? true;
    const nowMs = performance.now();
    const cutoffTime = this.audioContext.currentTime + RECORRECTION_CUTOVER_GUARD_SEC;
    if (incrementResyncCount) {
      this.resyncCount++;
      this._intervalResyncCount++;
    }
    this.resetSyncErrorEma();
    this.currentCorrectionMethod = "resync";
    this.lastSamplesAdjusted = 0;
    this.currentPlaybackRate = 1;
    const cutResult = this.cutScheduledSources(cutoffTime);
    this.recorrectionMonitor.setMinScheduleTime(Math.max(cutoffTime, cutResult.keptTailEndTimeSec));
    this.nextPlaybackTime = 0;
    this.nextScheduleTime = 0;
    this.lastScheduledServerTime = 0;
    this.recorrectionMonitor.resetCheckState();
    if (markCooldown)
      this.recorrectionMonitor.markRecorrection(nowMs);
    this.recorrectionMonitor.noteHardResync(nowMs);
    this.processAudioQueue();
  }
  checkRecorrection() {
    if (!this.usesRecorrectionMonitor) {
      this.recorrectionMonitor.resetCheckState();
      return;
    }
    if (!this.audioContext || this.audioContext.state !== "running") {
      this.recorrectionMonitor.resetCheckState();
      return;
    }
    if (!this.stateManager.isPlaying || this.nextPlaybackTime === 0 || this.lastScheduledServerTime === 0) {
      this.recorrectionMonitor.resetCheckState();
      return;
    }
    const { audioContextTimeSec, audioContextRawTimeSec, nowMs, nowUs } = this.clockSource.getTimingSnapshot(this.audioContext);
    this.pruneExpiredScheduledSources(audioContextRawTimeSec);
    if (this.getScheduledAheadSec(audioContextRawTimeSec) <= 0) {
      this.recorrectionMonitor.resetCheckState();
      if (this.audioBufferQueue.length > 0)
        this.processAudioQueue();
      return;
    }
    const outputLatencySec = this.useOutputLatencyCompensation ? this.latencyTracker.getSmoothedUs(this.audioContext) / 1e6 : 0;
    const targetPlaybackTime = this.computeTargetPlaybackTime(this.lastScheduledServerTime, audioContextTimeSec, nowUs, outputLatencySec);
    const syncErrorMs = (this.nextPlaybackTime - targetPlaybackTime) * 1e3;
    const smoothedSyncErrorMs = this.applySyncErrorEma(syncErrorMs);
    if (this.recorrectionMonitor.shouldRecorrect(Math.abs(smoothedSyncErrorMs), syncErrorMs, nowMs)) {
      this.performGuardedCutover("recorrection", {
        incrementResyncCount: true,
        markCooldown: true
      });
    }
  }
  getSyncDelayMs() {
    return this.syncDelayMs;
  }
  setSyncDelay(delayMs) {
    const sanitized = clampSyncDelayMs(delayMs);
    const delta = sanitized - this.syncDelayMs;
    this.syncDelayMs = sanitized;
    if (delta === 0 || !this.usesImmediateDelayCutover)
      return;
    if (!this.audioContext || this.audioContext.state !== "running")
      return;
    if (!this.stateManager.isPlaying)
      return;
    if (this.scheduledSources.length === 0 && this.audioBufferQueue.length === 0 && this.nextPlaybackTime === 0)
      return;
    this.performGuardedCutover("delay-change", {
      incrementResyncCount: false,
      markCooldown: true
    });
  }
  get syncInfo() {
    return {
      clockDriftPercent: this.timeFilter.drift * 100,
      syncErrorMs: this.currentSyncErrorMs,
      resyncCount: this.resyncCount,
      outputLatencyMs: this.latencyTracker.getRawUs(this.audioContext) / 1e3,
      playbackRate: this.currentPlaybackRate,
      correctionMethod: this.currentCorrectionMethod,
      samplesAdjusted: this.lastSamplesAdjusted,
      correctionMode: this._correctionMode
    };
  }
  emitStatusLog(nowMs) {
    if (this._lastStatusLogMs !== 0 && nowMs - this._lastStatusLogMs < 1e4)
      return;
    this._lastStatusLogMs = nowMs;
    let corr;
    switch (this.currentCorrectionMethod) {
      case "rate":
        corr = `rate@${this.currentPlaybackRate}`;
        break;
      case "samples":
        corr = `samples:${this.lastSamplesAdjusted}`;
        break;
      default:
        corr = this.currentCorrectionMethod;
    }
    const queueDepth = this.audioBufferQueue.length + this.scheduledSources.length;
    const aheadSec = this.audioContext ? this.getScheduledAheadSec(this.audioContext.currentTime) : 0;
    let clock;
    if (this.clockSource.timestampPromotionDisabled) {
      clock = "estimated(cast-disabled)";
    } else if (this.clockSource.active === "timestamp") {
      clock = `timestamp(good:${this.clockSource.timestampGoodSamples})`;
    } else if (this.clockSource.lastRejectReason) {
      clock = `estimated(reject:"${this.clockSource.lastRejectReason}")`;
    } else {
      clock = "estimated";
    }
    const tf = this.timeFilter.is_synchronized ? `synced(err=${(this.timeFilter.error / 1e3).toFixed(1)}ms,drift=${this.timeFilter.drift.toFixed(3)},n=${this.timeFilter.count})` : `pending(n=${this.timeFilter.count})`;
    const smoothedLatUs = this.latencyTracker.getSmoothedUs(this.audioContext);
    const latMs = Math.round(smoothedLatUs / 1e3);
    console.log(`Sendspin: sync=${this.smoothedSyncErrorMs >= 0 ? "+" : ""}${this.smoothedSyncErrorMs.toFixed(1)}ms corr=${corr} q=${queueDepth}/${aheadSec.toFixed(1)}s resyncs=${this._intervalResyncCount} clock=${clock} tf=${tf} lat=${latMs}ms mode=${this._correctionMode} ctx=${this.audioContext?.state ?? "null"} gen=${this.stateManager.streamGeneration}`);
    this._intervalResyncCount = 0;
  }
  applySyncErrorEma(inputMs) {
    this.currentSyncErrorMs = inputMs;
    this.smoothedSyncErrorMs = SYNC_ERROR_ALPHA * inputMs + (1 - SYNC_ERROR_ALPHA) * this.smoothedSyncErrorMs;
    return this.smoothedSyncErrorMs;
  }
  resetSyncErrorEma() {
    this.smoothedSyncErrorMs = 0;
  }
  copyBuffer(buffer) {
    if (!this.audioContext)
      return buffer;
    const newBuffer = this.audioContext.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      newBuffer.getChannelData(ch).set(buffer.getChannelData(ch));
    }
    return newBuffer;
  }
  adjustBufferSamples(buffer, samplesToAdjust) {
    if (!this.audioContext || samplesToAdjust === 0 || buffer.length < 2)
      return this.copyBuffer(buffer);
    const channels = buffer.numberOfChannels;
    const len = buffer.length;
    const sampleRate = buffer.sampleRate;
    try {
      if (samplesToAdjust > 0) {
        const newBuffer = this.audioContext.createBuffer(channels, len + 1, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
          const oldData = buffer.getChannelData(ch);
          const newData = newBuffer.getChannelData(ch);
          newData[0] = oldData[0];
          const insertedSample = (oldData[0] + oldData[1]) / 2;
          newData[1] = insertedSample;
          newData.set(oldData.subarray(1), 2);
          for (let f = 0; f < SAMPLE_CORRECTION_FADE_LEN; f++) {
            const pos = 2 + f;
            if (pos >= newData.length)
              break;
            const alpha = SAMPLE_CORRECTION_FADE_ALPHAS[f];
            newData[pos] = newData[pos] * (1 - alpha) + insertedSample * alpha;
          }
        }
        return newBuffer;
      } else {
        const newBuffer = this.audioContext.createBuffer(channels, len - 1, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
          const oldData = buffer.getChannelData(ch);
          const newData = newBuffer.getChannelData(ch);
          newData.set(oldData.subarray(0, len - 2));
          const replacementSample = (oldData[len - 2] + oldData[len - 1]) / 2;
          newData[len - 2] = replacementSample;
          for (let f = 0; f < SAMPLE_CORRECTION_FADE_LEN; f++) {
            const pos = len - 3 - f;
            if (pos < 0)
              break;
            const alpha = SAMPLE_CORRECTION_FADE_ALPHAS[f];
            newData[pos] = newData[pos] * (1 - alpha) + replacementSample * alpha;
          }
        }
        return newBuffer;
      }
    } catch (e) {
      console.error("Sendspin: adjustBufferSamples error:", e);
      return buffer;
    }
  }
  initAudioContext() {
    if (this.audioContext)
      return;
    if (this.outputMode === "media-element" && this.ownsAudioElement) {
      this.audioElement = document.createElement("audio");
      this.audioElement.style.display = "none";
      document.body.appendChild(this.audioElement);
    }
    if (navigator.audioSession) {
      navigator.audioSession.type = "playback";
    }
    const streamSampleRate = this.stateManager.currentStreamFormat?.sample_rate || 48e3;
    this.audioContext = new AudioContext({ sampleRate: streamSampleRate });
    this.gainNode = this.audioContext.createGain();
    const audioElement = this.audioElement;
    if (this.outputMode === "direct") {
      this.gainNode.connect(this.audioContext.destination);
    } else {
      if (!audioElement)
        throw new Error("Media-element output requires an audio element.");
      if (this.isAndroid && this.silentAudioSrc) {
        this.gainNode.connect(this.audioContext.destination);
        audioElement.src = this.silentAudioSrc;
        audioElement.loop = true;
        audioElement.muted = false;
        audioElement.volume = 1;
        audioElement.play().catch((e) => {
          console.warn("Sendspin: Audio autoplay blocked:", e);
        });
      } else {
        this.streamDestination = this.audioContext.createMediaStreamDestination();
        this.gainNode.connect(this.streamDestination);
        audioElement.srcObject = this.streamDestination.stream;
        audioElement.volume = 1;
        audioElement.play().catch((e) => {
          console.warn("Sendspin: Audio autoplay blocked:", e);
        });
      }
    }
    this.updateVolume();
    if (this.usesRecorrectionMonitor)
      this.recorrectionMonitor.start();
  }
  async resumeAudioContext() {
    if (this.audioContext && this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
        console.log("Sendspin: AudioContext resumed");
      } catch (e) {
        console.warn("Sendspin: Failed to resume AudioContext:", e);
        return;
      }
      if (this.audioBufferQueue.length > 0)
        this.scheduleQueueProcessing();
      if (this.usesRecorrectionMonitor)
        this.recorrectionMonitor.start();
    }
  }
  cutScheduledSources(cutoffTime) {
    if (!this.audioContext)
      return { requeuedCount: 0, cutCount: 0, keptTailEndTimeSec: 0 };
    const stopTime = Math.max(cutoffTime, this.audioContext.currentTime);
    let requeued = 0, cutCount = 0, keptTailEndTimeSec = 0;
    this.scheduledSources = this.scheduledSources.filter((entry) => {
      if (entry.startTime < stopTime) {
        keptTailEndTimeSec = Math.max(keptTailEndTimeSec, entry.endTime);
        return true;
      }
      try {
        entry.source.onended = null;
        entry.source.stop(stopTime);
      } catch {
      }
      this.audioBufferQueue.push({
        buffer: entry.buffer,
        serverTime: entry.serverTime,
        generation: entry.generation
      });
      requeued++;
      cutCount++;
      return false;
    });
    return { requeuedCount: requeued, cutCount, keptTailEndTimeSec };
  }
  updateVolume() {
    if (!this.gainNode)
      return;
    if (this.useHardwareVolume) {
      this.gainNode.gain.value = 1;
      return;
    }
    const target = this.stateManager.muted ? 0 : perceptualGain(this.stateManager.volume);
    if (this.audioContext) {
      this.gainNode.gain.setTargetAtTime(target, this.audioContext.currentTime, VOLUME_RAMP_TIME_CONSTANT_SEC);
    } else {
      this.gainNode.gain.value = target;
    }
  }
  measureBufferedPlaybackRunwaySec() {
    if (!this.audioContext)
      return 0;
    const currentTimeSec = this.audioContext.currentTime;
    this.pruneExpiredScheduledSources(currentTimeSec);
    const scheduledAheadSec = this.getScheduledAheadSec(currentTimeSec);
    const queuedAheadSec = this.audioBufferQueue.reduce((totalSec, chunk) => totalSec + chunk.buffer.duration, 0);
    return Math.max(0, scheduledAheadSec + queuedAheadSec);
  }
  cancelScheduledRefill() {
    if (this.refillTimeout !== null) {
      clearTimeout(this.refillTimeout);
      this.refillTimeout = null;
    }
  }
  getScheduledRefillThresholdSec(targetScheduledHorizonSec) {
    return Math.max(SCHEDULE_REFILL_MIN_THRESHOLD_SEC, Math.min(SCHEDULE_REFILL_MAX_THRESHOLD_SEC, targetScheduledHorizonSec * SCHEDULE_REFILL_THRESHOLD_FRACTION));
  }
  scheduleQueueRefill(targetScheduledHorizonSec) {
    this.cancelScheduledRefill();
    if (!this.audioContext || this.audioContext.state !== "running" || !this.stateManager.isPlaying || this.audioBufferQueue.length === 0)
      return;
    const currentTimeSec = this.audioContext.currentTime;
    this.pruneExpiredScheduledSources(currentTimeSec);
    const scheduledAheadSec = this.getScheduledAheadSec(currentTimeSec);
    const refillThresholdSec = this.getScheduledRefillThresholdSec(targetScheduledHorizonSec);
    if (scheduledAheadSec <= refillThresholdSec) {
      this.scheduleQueueProcessing();
      return;
    }
    const delayMs = (scheduledAheadSec - refillThresholdSec) * 1e3;
    const runRefill = () => {
      this.refillTimeout = null;
      if (!this.audioContext || this.audioContext.state !== "running" || !this.stateManager.isPlaying || this.audioBufferQueue.length === 0)
        return;
      this.scheduleQueueProcessing();
    };
    if (typeof globalThis.setTimeout === "function") {
      this.refillTimeout = globalThis.setTimeout(runRefill, delayMs);
      return;
    }
    this.refillTimeout = null;
    if (typeof globalThis.queueMicrotask === "function") {
      globalThis.queueMicrotask(runRefill);
      return;
    }
    void Promise.resolve().then(runRefill);
  }
  scheduleQueueProcessing() {
    this.cancelScheduledRefill();
    if (this.queueProcessScheduled)
      return;
    this.queueProcessScheduled = true;
    if (typeof globalThis.setTimeout === "function") {
      this.scheduleTimeout = globalThis.setTimeout(() => {
        this.scheduleTimeout = null;
        this.queueProcessScheduled = false;
        this.processAudioQueue();
      }, 15);
      return;
    }
    const run = () => {
      this.queueProcessScheduled = false;
      this.processAudioQueue();
    };
    if (typeof globalThis.queueMicrotask === "function") {
      globalThis.queueMicrotask(run);
    } else {
      Promise.resolve().then(run);
    }
  }
  handleDecodedChunk(chunk) {
    if (!this.audioContext || !this.gainNode) {
      console.warn("Sendspin: Received audio chunk but no audio context");
      return;
    }
    if (chunk.generation !== this.stateManager.streamGeneration)
      return;
    const numChannels = chunk.samples.length;
    const numFrames = chunk.samples[0].length;
    const audioBuffer = this.audioContext.createBuffer(numChannels, numFrames, chunk.sampleRate);
    for (let ch = 0; ch < numChannels; ch++)
      audioBuffer.getChannelData(ch).set(chunk.samples[ch]);
    this.audioBufferQueue.push({
      buffer: audioBuffer,
      serverTime: chunk.serverTimeUs,
      generation: chunk.generation
    });
    this.scheduleQueueProcessing();
  }
  processAudioQueue() {
    this.cancelScheduledRefill();
    if (!this.audioContext || !this.gainNode)
      return;
    if (this.audioContext.state !== "running")
      return;
    const currentGeneration = this.stateManager.streamGeneration;
    this.audioBufferQueue = this.audioBufferQueue.filter((chunk) => chunk.generation === currentGeneration);
    this.audioBufferQueue.sort((a, b) => a.serverTime - b.serverTime);
    if (!this.timeFilter.is_synchronized)
      return;
    const { audioContextTimeSec: audioContextTime, audioContextRawTimeSec, nowMs, nowUs } = this.clockSource.getTimingSnapshot(this.audioContext);
    this.pruneExpiredScheduledSources(audioContextRawTimeSec);
    const outputLatencySec = this.useOutputLatencyCompensation ? this.latencyTracker.getSmoothedUs(this.audioContext) / 1e6 : 0;
    const syncDelaySec = this.syncDelayMs / 1e3;
    const targetScheduledHorizonSec = this.getTargetScheduledHorizonSec();
    if (this.usesRecorrectionMonitor)
      this.recorrectionMonitor.start();
    if (this.clockSource.pendingCutover) {
      this.clockSource.pendingCutover = false;
      if (this.scheduledSources.length > 0 || this.nextPlaybackTime !== 0 || this.lastScheduledServerTime !== 0) {
        this.performGuardedCutover("delay-change", {
          incrementResyncCount: false,
          markCooldown: false
        });
        return;
      }
    }
    while (this.audioBufferQueue.length > 0) {
      const scheduledAheadSec = this.getScheduledAheadSec(audioContextRawTimeSec);
      if (this.nextPlaybackTime > 0 && scheduledAheadSec >= targetScheduledHorizonSec)
        break;
      const chunk = this.audioBufferQueue.shift();
      let playbackTime;
      let scheduleTime;
      let playbackRate;
      const targetPlaybackTime = this.computeTargetPlaybackTime(chunk.serverTime, audioContextTime, nowUs, outputLatencySec);
      const isTimestamp = this.clockSource.active === "timestamp";
      if (this.nextPlaybackTime === 0 || this.lastScheduledServerTime === 0) {
        this.recorrectionMonitor.armStartupGrace(nowMs, isTimestamp);
        playbackTime = targetPlaybackTime;
        scheduleTime = playbackTime - syncDelaySec;
        const minScheduleTimeSec = this.recorrectionMonitor.minScheduleTimeSec;
        if (minScheduleTimeSec !== null) {
          scheduleTime = Math.max(scheduleTime, minScheduleTimeSec);
          playbackTime = scheduleTime + syncDelaySec;
        }
        this.recorrectionMonitor.clearMinScheduleTime();
        playbackRate = 1;
        chunk.buffer = this.copyBuffer(chunk.buffer);
      } else {
        const serverGapUs = chunk.serverTime - this.lastScheduledServerTime;
        const serverGapSec = serverGapUs / 1e6;
        if (Math.abs(serverGapSec) < 0.1) {
          const syncErrorSec = this.nextPlaybackTime - targetPlaybackTime;
          const syncErrorMs = syncErrorSec * 1e3;
          const correctionErrorMs = this.applySyncErrorEma(syncErrorMs);
          const thresholds = this.correctionThresholds[this._correctionMode];
          const canHardResync = this.recorrectionMonitor.canUseHardResync(nowMs, isTimestamp);
          if (Math.abs(correctionErrorMs) > thresholds.resyncAboveMs && canHardResync) {
            this.recorrectionMonitor.noteHardResync(nowMs);
            this.resyncCount++;
            this._intervalResyncCount++;
            this.resetSyncErrorEma();
            this.cutScheduledSources(targetPlaybackTime - syncDelaySec);
            playbackTime = targetPlaybackTime;
            scheduleTime = playbackTime - syncDelaySec;
            playbackRate = 1;
            this.currentCorrectionMethod = "resync";
            this.lastSamplesAdjusted = 0;
            chunk.buffer = this.copyBuffer(chunk.buffer);
          } else if (Math.abs(correctionErrorMs) > thresholds.resyncAboveMs) {
            playbackTime = this.nextPlaybackTime;
            scheduleTime = this.nextScheduleTime;
            playbackRate = Number.isFinite(thresholds.rate2AboveMs) ? correctionErrorMs > 0 ? 1.02 : 0.98 : 1;
            this.currentCorrectionMethod = playbackRate === 1 ? "none" : "rate";
            this.lastSamplesAdjusted = 0;
            chunk.buffer = this.copyBuffer(chunk.buffer);
          } else if (Math.abs(correctionErrorMs) < thresholds.deadbandBelowMs) {
            playbackTime = this.nextPlaybackTime;
            scheduleTime = this.nextScheduleTime;
            playbackRate = 1;
            this.currentCorrectionMethod = "none";
            this.lastSamplesAdjusted = 0;
            chunk.buffer = this.copyBuffer(chunk.buffer);
          } else if (Math.abs(correctionErrorMs) <= thresholds.samplesBelowMs) {
            playbackTime = this.nextPlaybackTime;
            scheduleTime = this.nextScheduleTime;
            playbackRate = 1;
            const samplesToAdjust = correctionErrorMs > 0 ? -1 : 1;
            chunk.buffer = this.adjustBufferSamples(chunk.buffer, samplesToAdjust);
            this.currentCorrectionMethod = "samples";
            this.lastSamplesAdjusted = samplesToAdjust;
          } else {
            playbackTime = this.nextPlaybackTime;
            scheduleTime = this.nextScheduleTime;
            const absErrorMs = Math.abs(correctionErrorMs);
            if (correctionErrorMs > 0) {
              playbackRate = absErrorMs >= thresholds.rate2AboveMs ? 1.02 : absErrorMs >= thresholds.rate1AboveMs ? 1.01 : 1;
            } else {
              playbackRate = absErrorMs >= thresholds.rate2AboveMs ? 0.98 : absErrorMs >= thresholds.rate1AboveMs ? 0.99 : 1;
            }
            this.currentCorrectionMethod = playbackRate === 1 ? "none" : "rate";
            this.lastSamplesAdjusted = 0;
            chunk.buffer = this.copyBuffer(chunk.buffer);
          }
        } else {
          if (this.recorrectionMonitor.canUseHardResync(nowMs, isTimestamp)) {
            this.recorrectionMonitor.noteHardResync(nowMs);
            this.resyncCount++;
            this._intervalResyncCount++;
            this.cutScheduledSources(targetPlaybackTime - syncDelaySec);
          }
          playbackTime = targetPlaybackTime;
          scheduleTime = playbackTime - syncDelaySec;
          playbackRate = 1;
          this.currentCorrectionMethod = "resync";
          this.lastSamplesAdjusted = 0;
          chunk.buffer = this.copyBuffer(chunk.buffer);
        }
      }
      this.currentPlaybackRate = playbackRate;
      if (playbackTime < audioContextRawTimeSec) {
        this.nextPlaybackTime = 0;
        this.nextScheduleTime = 0;
        this.lastScheduledServerTime = 0;
        continue;
      }
      const effectiveScheduleTime = Math.max(scheduleTime, audioContextRawTimeSec);
      const effectivePlaybackTime = effectiveScheduleTime + (playbackTime - scheduleTime);
      const source = this.audioContext.createBufferSource();
      source.buffer = chunk.buffer;
      source.playbackRate.value = playbackRate;
      source.connect(this.gainNode);
      source.start(effectiveScheduleTime);
      const actualDuration = chunk.buffer.duration / playbackRate;
      this.nextPlaybackTime = effectivePlaybackTime + actualDuration;
      this.nextScheduleTime = effectiveScheduleTime + actualDuration;
      this.lastScheduledServerTime = chunk.serverTime + chunk.buffer.duration * 1e6;
      const scheduledEntry = {
        source,
        startTime: effectiveScheduleTime,
        endTime: effectiveScheduleTime + actualDuration,
        buffer: chunk.buffer,
        serverTime: chunk.serverTime,
        generation: chunk.generation
      };
      this.scheduledSources.push(scheduledEntry);
      source.onended = () => {
        const idx = this.scheduledSources.indexOf(scheduledEntry);
        if (idx > -1)
          this.scheduledSources.splice(idx, 1);
        if (this.scheduledSources.length === 0) {
          this.resetScheduledPlaybackState("all scheduled audio ended");
          if (this.audioBufferQueue.length > 0)
            this.processAudioQueue();
        }
      };
    }
    this.scheduleQueueRefill(targetScheduledHorizonSec);
    this.emitStatusLog(nowMs);
  }
  computeTargetPlaybackTime(serverTimeUs, audioContextTime, nowUs, outputLatencySec) {
    const chunkClientTimeUs = this.timeFilter.computeClientTime(serverTimeUs);
    const deltaSec = (chunkClientTimeUs - nowUs) / 1e6;
    return audioContextTime + deltaSec + SCHEDULE_HEADROOM_SEC - outputLatencySec;
  }
  startAudioElement() {
    if (this.outputMode === "media-element" && this.audioElement?.paused) {
      this.audioElement.play().catch((e) => {
        console.warn("Sendspin: Failed to start audio element:", e);
      });
    }
  }
  stopAudioElement() {
    if (this.outputMode === "media-element" && this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }
  }
  clearBuffers() {
    this.recorrectionMonitor.fullReset();
    this.cancelScheduledRefill();
    this.scheduledSources.forEach((entry) => {
      try {
        entry.source.stop();
      } catch {
      }
    });
    this.scheduledSources = [];
    this.audioBufferQueue = [];
    if (this.scheduleTimeout !== null) {
      clearTimeout(this.scheduleTimeout);
      this.scheduleTimeout = null;
    }
    this.queueProcessScheduled = false;
    this.stateManager.resetStreamAnchors();
    this.resetScheduledPlaybackState();
    this.resyncCount = 0;
    this.latencyTracker.reset();
    this.clockSource.reset();
  }
  close() {
    this.clearBuffers();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.gainNode = null;
    this.streamDestination = null;
    if (this.outputMode === "media-element" && this.audioElement) {
      this.audioElement.pause();
      this.audioElement.srcObject = null;
      this.audioElement.loop = false;
      this.audioElement.removeAttribute("src");
      this.audioElement.load();
      if (this.ownsAudioElement) {
        this.audioElement.remove();
        this.audioElement = void 0;
      }
    }
  }
  getAudioContext() {
    return this.audioContext;
  }
};

// ../../../../tmp/sendspin-js-3.2.0/dist/silent-audio.generated.js
var SILENT_AUDIO_SRC = "data:audio/flac;base64,ZkxhQwAAACICQAJAAAAMAADIAfQBcAAHkwCKnZ7FLvzY30lWx+3k6wJCBAAALAwAAABMYXZmNjEuNy4xMDABAAAAFAAAAGVuY29kZXI9TGF2ZjYxLjcuMTAwgQAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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kkkkkkmSSSSSTJJJJJMkkkkySSSTJJJJMkkkk/+/+//f/7//9////////////z///z//8///P//n//+SSSSSSSSSSSSQkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkmSSSSSSSSSSSSSSST////+BVP//gkDBPnQAAAAOc/VEAP/////9//////////////////z////////+f/////////////////////////////////3///////////////////////////gAhn//gkDBTyQP///+c/y0Af/////5//////////////////////////////////v/////////////////////////////////P////////////////////+T8L/+CQMFfVAAAAA5z9xQB////////////3//////////////////////////////////+f///////////////////////////////////////////////gm0f/4JAwW/EAAAADnP9JAH///////7///////////////////////////////////////////////n///////////////////////////////////////+BEl//gkDBf7AAAAABAL//gkDBjWAAAAADVc//gkDBnRAAAAAEw0//gkDBrYAAAAAMeM//gkDBvfAAAAAL7k//gkDBzKAAAAAFD5//gkDB3NAAAAACmR//gkDB7EAAAAAKIp//gkDB/DAAAAANtB//gkDCB+AAAAAMWl//gkDCF5AAAAALzN//gkDCJwAAAAADd1//gkDCN3AAAAAE4d//gkDCRiAAAAAKAA//gkDCVlAAAAANlo//gkDCZsAAAAAFLQ//gkDCdrAAAAACu4//gkDChGAAAAAA7v//gkDClBAAAAAHeH//gkDCpIAAAAAPw///gkDCtPAAAAAIVX//gkDCxaAAAAAGtK//gkDC1dAAAAABIi//gkDC5UAAAAAJma//gkDC9TAAAAAODy//gkDDAOAAAAANM0//gkDDEJAAAAAKpc//gkDDIAAAAAACHk//gkDDMHAAAAAFiM//gkDDQSAAAAALaR//gkDDUVAAAAAM/5//gkDDYcAAAAAERB//gkDDcbAAAAAD0p//gkDDg2AAAAABh+//gkDDkxAAAAAGEW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";

// ../../../../tmp/sendspin-js-3.2.0/dist/types.js
var MessageType;
(function(MessageType2) {
  MessageType2["CLIENT_HELLO"] = "client/hello";
  MessageType2["SERVER_HELLO"] = "server/hello";
  MessageType2["CLIENT_TIME"] = "client/time";
  MessageType2["SERVER_TIME"] = "server/time";
  MessageType2["CLIENT_STATE"] = "client/state";
  MessageType2["SERVER_STATE"] = "server/state";
  MessageType2["CLIENT_COMMAND"] = "client/command";
  MessageType2["CLIENT_GOODBYE"] = "client/goodbye";
  MessageType2["SERVER_COMMAND"] = "server/command";
  MessageType2["STREAM_START"] = "stream/start";
  MessageType2["STREAM_CLEAR"] = "stream/clear";
  MessageType2["STREAM_REQUEST_FORMAT"] = "stream/request-format";
  MessageType2["STREAM_END"] = "stream/end";
  MessageType2["GROUP_UPDATE"] = "group/update";
})(MessageType || (MessageType = {}));

// ../../../../tmp/sendspin-js-3.2.0/dist/index.js
function detectIsAndroid() {
  if (typeof navigator === "undefined")
    return false;
  return /Android/i.test(navigator.userAgent);
}
function detectIsIOS() {
  if (typeof navigator === "undefined")
    return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}
function detectIsMobile() {
  return detectIsAndroid() || detectIsIOS();
}
function detectIsCastRuntime() {
  if (typeof navigator === "undefined")
    return false;
  return /CrKey/i.test(navigator.userAgent);
}
function detectIsSafari() {
  if (typeof navigator === "undefined")
    return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome/i.test(ua);
}
function detectIsMac() {
  if (typeof navigator === "undefined")
    return false;
  return /Macintosh/i.test(navigator.userAgent);
}
function detectIsWindows() {
  if (typeof navigator === "undefined")
    return false;
  return /Windows/i.test(navigator.userAgent);
}
function getDefaultSyncDelay() {
  if (detectIsIOS())
    return 250;
  if (detectIsAndroid())
    return 200;
  if (detectIsMac())
    return detectIsSafari() ? 190 : 150;
  if (detectIsWindows())
    return 250;
  return 200;
}
var DISCONNECT_PLAYBACK_RESET_GRACE_MS = 250;
var SendspinPlayer = class {
  constructor(config) {
    this.ownsAudioElement = false;
    this.disconnectPlaybackResetTimeout = null;
    this.suppressDisconnectPlaybackReset = false;
    const isAndroid = detectIsAndroid();
    const isCastRuntime = detectIsCastRuntime();
    const isMobile = detectIsMobile();
    const outputMode = config.audioElement || isMobile ? "media-element" : "direct";
    this.ownsAudioElement = outputMode === "media-element" && !config.audioElement;
    if (this.ownsAudioElement && typeof document === "undefined") {
      throw new Error("SendspinPlayer requires a DOM document to use media-element output without a provided audioElement.");
    }
    let storage = null;
    if (config.storage !== void 0) {
      storage = config.storage;
    } else if (typeof localStorage !== "undefined") {
      storage = localStorage;
    }
    this.core = new SendspinCore({
      playerId: config.playerId,
      baseUrl: config.baseUrl,
      clientName: config.clientName,
      webSocket: config.webSocket,
      codecs: config.codecs,
      bufferCapacity: config.bufferCapacity ?? (outputMode === "media-element" ? 1024 * 1024 * 5 : 1024 * 1024 * 1.5),
      syncDelay: config.syncDelay,
      defaultSyncDelay: getDefaultSyncDelay(),
      storage,
      requiredLeadTimeMs: config.requiredLeadTimeMs,
      minBufferMs: config.minBufferMs,
      useHardwareVolume: config.useHardwareVolume,
      onVolumeCommand: config.onVolumeCommand,
      onDelayCommand: config.onDelayCommand,
      getExternalVolume: config.getExternalVolume,
      reconnect: config.reconnect,
      onStateChange: config.onStateChange
    });
    const syncDelay = this.core.getSyncDelayMs();
    this.scheduler = new AudioScheduler({
      stateManager: this.core._stateManager,
      timeFilter: this.core._timeFilter,
      outputMode,
      audioElement: config.audioElement,
      isAndroid,
      isCastRuntime,
      ownsAudioElement: this.ownsAudioElement,
      silentAudioSrc: isAndroid ? SILENT_AUDIO_SRC : void 0,
      syncDelayMs: syncDelay,
      useHardwareVolume: config.useHardwareVolume ?? false,
      correctionMode: config.correctionMode ?? "sync",
      storage,
      useOutputLatencyCompensation: config.useOutputLatencyCompensation ?? true,
      correctionThresholds: config.correctionThresholds
    });
    this.core.onAudioData = (chunk) => {
      this.scheduler.handleDecodedChunk(chunk);
    };
    this.core.onStreamStart = (format, isFormatUpdate) => {
      this.scheduler.initAudioContext();
      this.scheduler.resumeAudioContext();
      if (!isFormatUpdate) {
        this.scheduler.clearBuffers();
      }
      this.scheduler.startAudioElement();
    };
    this.core.onStreamClear = () => {
      this.scheduler.clearBuffers();
    };
    this.core.onStreamEnd = () => {
      this.scheduler.clearBuffers();
      this.scheduler.stopAudioElement();
    };
    this.core.onVolumeUpdate = () => {
      this.scheduler.updateVolume();
    };
    this.core.onSyncDelayChange = (delayMs) => {
      this.scheduler.setSyncDelay(delayMs);
    };
    this.core.onConnectionOpen = () => {
      this.cancelPendingDisconnectPlaybackReset();
    };
    this.core.onConnectionClose = () => {
      if (this.suppressDisconnectPlaybackReset) {
        return;
      }
      this.scheduleDisconnectPlaybackReset();
    };
  }
  cancelPendingDisconnectPlaybackReset() {
    if (this.disconnectPlaybackResetTimeout !== null) {
      clearTimeout(this.disconnectPlaybackResetTimeout);
      this.disconnectPlaybackResetTimeout = null;
    }
  }
  resetPlaybackStateAfterDisconnect() {
    this.disconnectPlaybackResetTimeout = null;
    if (this.core.isConnected) {
      return;
    }
    this.scheduler.clearBuffers();
    this.core.resetPlaybackState();
    this.scheduler.stopAudioElement();
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      navigator.mediaSession.playbackState = "paused";
    }
  }
  scheduleDisconnectPlaybackReset() {
    this.cancelPendingDisconnectPlaybackReset();
    const runwaySec = this.scheduler.measureBufferedPlaybackRunwaySec();
    if (runwaySec <= 0) {
      this.resetPlaybackStateAfterDisconnect();
      return;
    }
    this.disconnectPlaybackResetTimeout = setTimeout(() => {
      this.resetPlaybackStateAfterDisconnect();
    }, runwaySec * 1e3 + DISCONNECT_PLAYBACK_RESET_GRACE_MS);
  }
  // Connect to Sendspin server
  async connect() {
    this.suppressDisconnectPlaybackReset = false;
    return this.core.connect();
  }
  /**
   * Disconnect from Sendspin server
   * @param reason - Optional reason for disconnecting (default: 'restart')
   */
  disconnect(reason = "restart") {
    this.cancelPendingDisconnectPlaybackReset();
    this.suppressDisconnectPlaybackReset = true;
    this.core.disconnect(reason);
    this.scheduler.close();
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
    }
  }
  // Set volume (0-100)
  setVolume(volume) {
    this.core.setVolume(volume);
  }
  // Set muted state
  setMuted(muted) {
    this.core.setMuted(muted);
  }
  // Set static delay (in milliseconds, 0-5000)
  setSyncDelay(delayMs) {
    this.core.setSyncDelay(delayMs);
  }
  /**
   * Update the reported startup lead time at runtime (ms). Reported to the
   * server via client/state. Debounce calls to avoid reacting to transient
   * fluctuations. Throws RangeError if not a non-negative finite number.
   */
  setRequiredLeadTimeMs(leadTimeMs) {
    this.core.setRequiredLeadTimeMs(leadTimeMs);
  }
  /**
   * Update the reported minimum ongoing buffer duration at runtime (ms).
   * Reported to the server via client/state. Debounce calls to avoid reacting
   * to transient fluctuations. Throws RangeError if not a non-negative finite
   * number.
   */
  setMinBufferMs(minBufferMs) {
    this.core.setMinBufferMs(minBufferMs);
  }
  /**
   * Set the sync correction mode at runtime.
   */
  setCorrectionMode(mode) {
    this.scheduler.setCorrectionMode(mode);
  }
  // ========================================
  // Controller Commands (sent to server)
  // ========================================
  /**
   * Send a controller command to the server.
   */
  sendCommand(command, params) {
    this.core.sendCommand(command, params);
  }
  // Getters for reactive state
  get isPlaying() {
    return this.core.isPlaying;
  }
  get volume() {
    return this.core.volume;
  }
  get muted() {
    return this.core.muted;
  }
  get playerState() {
    return this.core.playerState;
  }
  get currentFormat() {
    return this.core.currentFormat;
  }
  get isConnected() {
    return this.core.isConnected;
  }
  // Get current correction mode
  get correctionMode() {
    return this.scheduler.correctionMode;
  }
  // Time sync info for debugging
  get timeSyncInfo() {
    return this.core.timeSyncInfo;
  }
  /** Get current server time in microseconds using synchronized clock */
  getCurrentServerTimeUs() {
    return this.core.getCurrentServerTimeUs();
  }
  /** Get current track progress with real-time position calculation */
  get trackProgress() {
    return this.core.trackProgress;
  }
  // Sync info for debugging/display
  get syncInfo() {
    return this.scheduler.syncInfo;
  }
};
export {
  AudioScheduler,
  MessageType,
  SendspinCore,
  SendspinDecoder,
  SendspinPlayer,
  SendspinTimeFilter,
  detectIsAndroid,
  detectIsCastRuntime,
  detectIsIOS,
  detectIsMobile,
  getDefaultSyncDelay
};
