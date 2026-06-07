const fs = require('fs');
const path = require('path');

describe('Soundboard OBS overlay repeat playback', () => {
  let overlayHtml;

  beforeAll(() => {
    overlayHtml = fs.readFileSync(path.join(__dirname, '../public/animation-overlay.html'), 'utf8');
  });

  test('expands gift repeatCount before playing OBS overlay audio', () => {
    expect(overlayHtml).toContain('const MAX_SOUNDBOARD_REPEAT_PLAYS = 50');
    expect(overlayHtml).toContain('function normalizeSoundboardRepeatCount(data)');
    expect(overlayHtml).toContain('function playRepeatedSoundboardAudio(data)');
    expect(overlayHtml).toContain('playRepeatedSoundboardAudio(data)');
  });
});
