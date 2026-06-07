const fs = require('fs');
const path = require('path');

describe('Fireworks Dev Overlay', () => {
  let overlayContent;

  beforeAll(() => {
    overlayContent = fs.readFileSync(
      path.join(__dirname, '..', 'plugins', 'fireworks-dev', 'overlay.html'),
      'utf8'
    );
  });

  test('keeps transparent overlay requirements for OBS', () => {
    expect(overlayContent).toMatch(/html\s*{[^}]*background:\s*transparent/);
    expect(overlayContent).toMatch(/body\s*{[^}]*background:\s*transparent/);
    expect(overlayContent).toMatch(/#fireworks-dev-canvas/);
    expect(overlayContent).toContain('--scene-backdrop-opacity');
  });

  test('boots a WebGL2-only scene runtime', () => {
    expect(overlayContent).toContain('fireworks-dev-theme-layer');
    expect(overlayContent).toContain('fireworks-dev-hud');
    expect(overlayContent).toContain('fireworks-dev-webgl-scene');
    expect(overlayContent).toContain('arena-grid');
    expect(overlayContent).toContain('arena-sigil');
    expect(overlayContent).toContain('arena-fog');
    expect(overlayContent).toContain('fireworks-dev-screenpulse');
    expect(overlayContent).toContain('window.FIREWORKS_DEV_REQUIRE_WEBGL2');
    expect(overlayContent).toContain('/plugins/fireworks-dev/gpu/webgl-scene.js');
    expect(overlayContent).toContain('/plugins/fireworks-dev/gpu/runtime-bootstrap.js');
  });

  test('supports per-layer arena backdrop editing hooks', () => {
    expect(overlayContent).toContain('--scene-layer-sky-opacity');
    expect(overlayContent).toContain('--scene-layer-stars-opacity');
    expect(overlayContent).toContain('--scene-layer-grid-opacity');
    expect(overlayContent).toContain('--scene-layer-sigil-opacity');
    expect(overlayContent).toContain('--scene-layer-fog-opacity');
  });

  test('includes a visible unsupported-state message for missing WebGL2', () => {
    expect(overlayContent).toContain('fireworks-dev-unsupported');
    expect(overlayContent).toContain('WebGL2 is required');
  });

  test('shows combat HUD telemetry beyond the original overlay', () => {
    expect(overlayContent).toContain('attack-class-value');
    expect(overlayContent).toContain('quality-profile-value');
    expect(overlayContent).toContain('phase-label-value');
    expect(overlayContent).toContain('pattern-label-value');
  });

  test('keeps a dedicated layer for legacy gift popups and special callouts', () => {
    expect(overlayContent).toContain('fireworks-dev-popups');
    expect(overlayContent).toContain('fx-gift-popup');
  });
});
