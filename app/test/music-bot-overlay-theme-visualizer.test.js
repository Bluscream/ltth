const fs = require('fs');
const path = require('path');

describe('Music Bot overlay theme engine and visualizer', () => {
  let overlayHtml;

  beforeAll(() => {
    overlayHtml = fs.readFileSync(
      path.join(__dirname, '../plugins/music-bot/overlay.html'),
      'utf8'
    );
  });

  test('supports required theme names in URL parsing', () => {
    expect(overlayHtml).toContain("const allowedThemes = new Set(['default', 'cyberpunk', 'minimal', 'neon'])");
    expect(overlayHtml).toContain('themeAliases');
  });

  test('contains visualizer canvas and analyser wiring', () => {
    expect(overlayHtml).toContain('id="visualizer-canvas"');
    expect(overlayHtml).toContain('createAnalyser()');
    expect(overlayHtml).toContain('requestAnimationFrame(draw)');
    expect(overlayHtml).toContain('getByteFrequencyData');
  });
});
