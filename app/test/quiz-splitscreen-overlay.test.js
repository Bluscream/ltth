const fs = require('fs');
const path = require('path');

describe('Quiz Show Splitscreen Overlay', () => {
  let mainJs;
  let overlayJs;
  let overlayCss;
  let dashboardHtml;
  let dashboardJs;

  beforeAll(() => {
    const pluginDir = path.join(__dirname, '../plugins/quiz-show');
    mainJs = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');
    overlayJs = fs.readFileSync(path.join(pluginDir, 'quiz_show_overlay.js'), 'utf8');
    overlayCss = fs.readFileSync(path.join(pluginDir, 'quiz_show_overlay.css'), 'utf8');
    dashboardHtml = fs.readFileSync(path.join(pluginDir, 'quiz_show.html'), 'utf8');
    dashboardJs = fs.readFileSync(path.join(pluginDir, 'quiz_show.js'), 'utf8');
  });

  test('registers a named OBS route for the splitscreen overlay', () => {
    expect(mainJs).toContain("'/quiz-show/overlay/splitscreen'");
    expect(mainJs).toContain('quiz_show_overlay.html');
    expect(mainJs).toContain("splitscreenUrl: '/quiz-show/overlay/splitscreen'");
  });

  test('seeds a reusable splitscreen portrait layout preset', () => {
    expect(mainJs).toContain("'splitscreen'");
    expect(mainJs).toContain('1080, 1920');
    expect(mainJs).toContain("mode: 'splitscreen'");
  });

  test('overlay JavaScript detects and protects splitscreen mode', () => {
    expect(overlayJs).toContain('isSplitscreenOverlay');
    expect(overlayJs).toContain("data-overlay-mode', 'splitscreen'");
    expect(overlayJs).toContain('getEffectiveTimerVariant');
    expect(overlayJs).toContain('return \'bar\'');
  });

  test('splitscreen CSS constrains quiz UI to the lower portrait playfield', () => {
    expect(overlayCss).toContain('SPLITSCREEN OVERLAY');
    expect(overlayCss).toContain('data-overlay-mode="splitscreen"');
    expect(overlayCss).toContain('--splitscreen-stage-top');
    expect(overlayCss).toContain('--splitscreen-stage-width');
    expect(overlayCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  test('dashboard exposes the OBS URL and opens a 1080x1920 preview', () => {
    expect(dashboardHtml).toContain('openSplitscreenOverlayBtn');
    expect(dashboardHtml).toContain('/quiz-show/overlay/splitscreen');
    expect(dashboardJs).toContain('openSplitscreenOverlay');
    expect(dashboardJs).toContain("width=1080,height=1920");
  });
});
