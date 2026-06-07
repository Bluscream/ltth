const {
  measureAudioDuration,
  resolvePlaybackDuration
} = require('../plugins/tts/utils/audio-duration');

function createWavBuffer(durationMs, sampleRate = 8000, channels = 1, bitsPerSample = 16) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.floor((durationMs / 1000) * sampleRate * channels * bytesPerSample);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function createMp3Frames(frameCount) {
  const frameLength = 417;
  const frames = [];

  for (let i = 0; i < frameCount; i++) {
    const frame = Buffer.alloc(frameLength);
    frame[0] = 0xff;
    frame[1] = 0xfb;
    frame[2] = 0x90;
    frame[3] = 0x64;
    frames.push(frame);
  }

  return Buffer.concat(frames);
}

describe('TTS audio duration measurement', () => {
  test('measures WAV duration from base64 audio data', () => {
    const audioData = createWavBuffer(2000).toString('base64');

    const result = measureAudioDuration(audioData);

    expect(result).toMatchObject({
      format: 'wav',
      source: 'audio_header'
    });
    expect(result.durationMs).toBeCloseTo(2000, -1);
  });

  test('measures MP3 duration by summing audio frames', () => {
    const audioData = createMp3Frames(10).toString('base64');

    const result = measureAudioDuration(audioData);

    expect(result).toMatchObject({
      format: 'mp3',
      source: 'audio_frames',
      frameCount: 10
    });
    expect(result.durationMs).toBeCloseTo(261, 0);
  });

  test('falls back to text estimate when audio duration cannot be measured', () => {
    const result = resolvePlaybackDuration({
      audioData: Buffer.from('not-a-supported-audio-format').toString('base64'),
      text: 'Hello world',
      speed: 1
    });

    expect(result.source).toBe('text_estimate');
    expect(result.durationMs).toBeGreaterThan(0);
  });
});
