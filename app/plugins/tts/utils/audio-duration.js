const MPEG_VERSION_SAMPLE_RATES = {
  0: [11025, 12000, 8000],  // MPEG 2.5
  2: [22050, 24000, 16000], // MPEG 2
  3: [44100, 48000, 32000]  // MPEG 1
};

const MPEG1_BITRATES = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
};

const MPEG2_BITRATES = {
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};

function toBuffer(audioData) {
  if (!audioData) {
    return null;
  }

  if (Buffer.isBuffer(audioData)) {
    return audioData;
  }

  if (typeof audioData === 'string') {
    return Buffer.from(audioData, 'base64');
  }

  return null;
}

function measureWavDuration(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let byteRate = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkDataOffset + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(chunkDataOffset + 8);
    } else if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, buffer.length - chunkDataOffset);
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize) {
    return null;
  }

  return {
    durationMs: Math.round((dataSize / byteRate) * 1000),
    format: 'wav',
    source: 'audio_header'
  };
}

function getMp3StartOffset(buffer) {
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 3) === 'ID3') {
    const tagSize = ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    return 10 + tagSize;
  }

  return 0;
}

function parseMp3FrameHeader(buffer, offset) {
  if (offset + 4 > buffer.length) {
    return null;
  }

  const header = buffer.readUInt32BE(offset);
  if (((header >>> 21) & 0x7ff) !== 0x7ff) {
    return null;
  }

  const versionBits = (header >> 19) & 0x3;
  const layerBits = (header >> 17) & 0x3;
  const bitrateIndex = (header >> 12) & 0xf;
  const sampleRateIndex = (header >> 10) & 0x3;
  const padding = (header >> 9) & 0x1;

  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  const sampleRates = MPEG_VERSION_SAMPLE_RATES[versionBits];
  const sampleRate = sampleRates ? sampleRates[sampleRateIndex] : null;
  const layer = 4 - layerBits; // 1 = Layer I, 2 = Layer II, 3 = Layer III
  const bitrateTable = versionBits === 3 ? MPEG1_BITRATES : MPEG2_BITRATES;
  const bitrateKbps = bitrateTable[layer] ? bitrateTable[layer][bitrateIndex] : null;

  if (!sampleRate || !bitrateKbps) {
    return null;
  }

  let samplesPerFrame;
  let frameLength;

  if (layer === 1) {
    samplesPerFrame = 384;
    frameLength = Math.floor(((12 * bitrateKbps * 1000) / sampleRate + padding) * 4);
  } else if (layer === 2) {
    samplesPerFrame = 1152;
    frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate + padding);
  } else {
    samplesPerFrame = versionBits === 3 ? 1152 : 576;
    const coefficient = versionBits === 3 ? 144 : 72;
    frameLength = Math.floor((coefficient * bitrateKbps * 1000) / sampleRate + padding);
  }

  if (frameLength <= 4) {
    return null;
  }

  return {
    frameLength,
    durationMs: (samplesPerFrame / sampleRate) * 1000
  };
}

function measureMp3Duration(buffer) {
  let offset = getMp3StartOffset(buffer);
  let durationMs = 0;
  let frameCount = 0;

  while (offset + 4 <= buffer.length) {
    const frame = parseMp3FrameHeader(buffer, offset);

    if (!frame || offset + frame.frameLength > buffer.length) {
      offset += 1;
      continue;
    }

    durationMs += frame.durationMs;
    frameCount += 1;
    offset += frame.frameLength;
  }

  if (frameCount === 0) {
    return null;
  }

  return {
    durationMs: Math.round(durationMs),
    format: 'mp3',
    source: 'audio_frames',
    frameCount
  };
}

function measureAudioDuration(audioData) {
  const buffer = toBuffer(audioData);
  if (!buffer || buffer.length < 4) {
    return null;
  }

  return measureWavDuration(buffer) || measureMp3Duration(buffer);
}

function estimateDurationFromText(text, speed = 1, bufferMs = 2000) {
  const safeText = typeof text === 'string' ? text : '';
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const baseDelay = Math.ceil(safeText.length * 100);
  return Math.ceil(baseDelay * (1 / safeSpeed)) + bufferMs;
}

function resolvePlaybackDuration(options = {}) {
  const {
    audioData,
    text,
    speed,
    measuredBufferMs = 250,
    estimateBufferMs = 2000
  } = options;

  const measured = measureAudioDuration(audioData);
  if (measured) {
    return {
      ...measured,
      measuredDurationMs: measured.durationMs,
      durationMs: measured.durationMs + measuredBufferMs,
      bufferMs: measuredBufferMs
    };
  }

  return {
    durationMs: estimateDurationFromText(text, speed, estimateBufferMs),
    source: 'text_estimate',
    format: 'unknown',
    bufferMs: estimateBufferMs
  };
}

module.exports = {
  measureAudioDuration,
  resolvePlaybackDuration,
  estimateDurationFromText
};
