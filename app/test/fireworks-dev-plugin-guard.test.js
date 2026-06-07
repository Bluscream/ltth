const FireworksDevPlugin = require('../plugins/fireworks-dev/main');

describe('Fireworks Dev plugin guard', () => {
  test('refuses initialization when stable fireworks is already active', async () => {
    const api = {
      getPlugin: jest.fn((pluginId) => pluginId === 'fireworks' ? {} : null),
      getPluginDataDir: jest.fn(() => __dirname),
      log: jest.fn()
    };

    const plugin = new FireworksDevPlugin(api);

    await expect(plugin.init()).rejects.toThrow(
      'fireworks-dev cannot start while stable fireworks is enabled'
    );
    expect(api.log).toHaveBeenCalledWith(
      expect.stringContaining('fireworks-dev cannot start while stable fireworks is enabled'),
      'error'
    );
  });
});
