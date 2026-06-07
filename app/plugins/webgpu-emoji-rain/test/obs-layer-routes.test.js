class MockAPI {
  constructor() {
    this.routes = [];
    this.logs = [];
    this.app = { use: jest.fn() };
    this.db = {
      getEmojiRainConfig: () => ({ enabled: true })
    };
  }

  log(message, level) {
    this.logs.push({ message, level });
  }

  emit() {}

  getSocketIO() {
    return { emit: jest.fn() };
  }

  getDatabase() {
    return this.db;
  }

  getPluginDataDir() {
    return '/tmp/test-plugin-data';
  }

  getConfigPathManager() {
    return {
      getUserConfigsDir: () => '/tmp/test-user-configs'
    };
  }

  getApp() {
    return this.app;
  }

  registerRoute(method, routePath, handler) {
    this.routes.push({ method, routePath, handler });
  }

  registerTikTokEvent() {}
  registerFlowAction() {}
}

describe('WebGPU Emoji Rain OBS layer routes', () => {
  test('registers dedicated OBS URLs for emoji, hearts, gifts, and emoji plus gifts', () => {
    jest.resetModules();
    const WebGPUEmojiRainPlugin = require('../main.js');
    const api = new MockAPI();
    const plugin = new WebGPUEmojiRainPlugin(api);

    plugin.registerRoutes();

    const routePaths = api.routes
      .filter(route => route.method === 'get')
      .map(route => route.routePath);

    expect(routePaths).toEqual(expect.arrayContaining([
      '/webgpu-emoji-rain/obs-hud',
      '/webgpu-emoji-rain/obs-hud/emojiregen',
      '/webgpu-emoji-rain/obs-hud/herzballons',
      '/webgpu-emoji-rain/obs-hud/geschenkeregen',
      '/webgpu-emoji-rain/obs-hud/emojiregen-geschenkeregen',
      '/webgpu-emoji-rain/obs-hud/emojis',
      '/webgpu-emoji-rain/obs-hud/hearts',
      '/webgpu-emoji-rain/obs-hud/gifts',
      '/webgpu-emoji-rain/obs-hud/emoji-gifts'
    ]));
  });
});
