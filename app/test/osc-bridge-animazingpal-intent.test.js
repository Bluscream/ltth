const OSCBridgePlugin = require('../plugins/osc-bridge/main');

function createApi(listeners) {
  return {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    },
    emit: jest.fn(),
    on: jest.fn((event, callback) => {
      listeners.set(event, callback);
    }),
    removeListener: jest.fn((event, callback) => {
      if (listeners.get(event) === callback) {
        listeners.delete(event);
      }
    }),
    getPluginDir: jest.fn(() => __dirname),
    registerRoute: jest.fn(),
    getConfig: jest.fn().mockResolvedValue({ enabled: false }),
    setConfig: jest.fn().mockResolvedValue(true),
    registerSocket: jest.fn(),
    registerTikTokEvent: jest.fn(),
    pluginLoader: {
      loadedPlugins: new Map()
    },
    getDatabase: jest.fn(() => ({
      prepare: jest.fn(() => ({
        get: jest.fn(),
        all: jest.fn()
      }))
    }))
  };
}

describe('OSC-Bridge AnimazingPal bridge', function() {
  afterEach(async function() {
    if (this.plugin && typeof this.plugin.destroy === 'function') {
      await this.plugin.destroy();
    }
    this.plugin = null;
  });

  it('registers a plugin-event listener and routes AnimazingPal intents into VRChat actions', async function() {
    const listeners = new Map();
    const api = createApi(listeners);
    const plugin = new OSCBridgePlugin(api);
    this.plugin = plugin;

    plugin.sendToChatbox = jest.fn().mockReturnValue(true);
    plugin.wave = jest.fn();
    plugin.celebrate = jest.fn();
    plugin.dance = jest.fn();
    plugin.hearts = jest.fn();
    plugin.confetti = jest.fn();
    plugin.triggerEmote = jest.fn();
    plugin.switchAvatar = jest.fn();

    await plugin.init();
    plugin.isRunning = true;

    const bridgeHandler = listeners.get('animazingpal:vrchat-intent');
    expect(bridgeHandler).toBeDefined();

    bridgeHandler({
      targetPluginId: 'osc-bridge',
      kind: 'chatbox',
      message: 'Hallo VRChat',
      showTyping: false,
      eventType: 'brainResponse',
      username: 'ViewerOne'
    });

    bridgeHandler({
      targetPluginId: 'osc-bridge',
      kind: 'gesture',
      gesture: 'dance',
      duration: 4321,
      username: 'ViewerOne'
    });

    bridgeHandler({
      targetPluginId: 'osc-bridge',
      kind: 'emote',
      slot: 3,
      duration: 1500,
      username: 'ViewerOne'
    });

    expect(plugin.sendToChatbox).toHaveBeenCalledWith('Hallo VRChat', false);
    expect(plugin.dance).toHaveBeenCalledWith(4321);
    expect(plugin.triggerEmote).toHaveBeenCalledWith(3, 1500);
  });
});
