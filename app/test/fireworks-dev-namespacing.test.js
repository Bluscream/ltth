const fs = require('fs');
const path = require('path');

describe('Fireworks Dev Namespacing And Guard', () => {
  let manifest;
  let mainJs;
  let settingsJs;

  beforeAll(() => {
    manifest = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'plugins', 'fireworks-dev', 'plugin.json'),
        'utf8'
      )
    );
    mainJs = fs.readFileSync(
      path.join(__dirname, '..', 'plugins', 'fireworks-dev', 'main.js'),
      'utf8'
    );
    settingsJs = fs.readFileSync(
      path.join(__dirname, '..', 'plugins', 'fireworks-dev', 'ui', 'settings.js'),
      'utf8'
    );
  });

  test('uses a separate plugin manifest identity', () => {
    expect(manifest.id).toBe('fireworks-dev');
    expect(manifest.enabled).toBe(false);
    expect(manifest.devStatus).toBe('experimental');
  });

  test('uses only the fireworks-dev route namespace in client API calls', () => {
    expect(settingsJs).toContain('/api/fireworks-dev/config');
    expect(settingsJs).toContain('/fireworks-dev/overlay');
    expect(settingsJs).toContain('fireworks-dev-benchmark-results');
  });

  test('uses a separate socket event namespace', () => {
    expect(mainJs).toContain('fireworks-dev:config-update');
    expect(mainJs).toContain('fireworks-dev:trigger');
    expect(mainJs).not.toContain("this.api.emit('fireworks:trigger'");
  });

  test('forwards dev scene overrides through finale and random routes', () => {
    expect(mainJs).toContain("this.triggerFinale(intensity || 3.0, duration || 5000, true, {");
    expect(mainJs).toContain("this.triggerRandomFirework(true, req.body || {})");
    expect(mainJs).toContain('sceneOverrides = {}');
  });

  test('aborts startup if stable fireworks is enabled', () => {
    expect(mainJs).toContain("this.api.getPlugin('fireworks')");
    expect(mainJs).toContain('fireworks-dev cannot start while stable fireworks is enabled');
  });
});
