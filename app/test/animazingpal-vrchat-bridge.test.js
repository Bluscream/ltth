const AnimazingPalPlugin = require('../plugins/animazingpal/main');

function createApi() {
  return {
    getSocketIO() {
      return { emit() {} };
    },
    getDatabase() {
      return {};
    },
    log() {},
    registerRoute() {},
    emit: jest.fn(),
    setConfig() {},
    getConfig() {
      return null;
    }
  };
}

describe('AnimazingPal VRChat bridge', function() {
  it('exposes a disabled default VRChat intent bridge that targets OSC-Bridge', function() {
    const plugin = new AnimazingPalPlugin(createApi());
    const config = plugin.getDefaultConfig();

    expect(config.vrchatIntegration).toBeDefined();
    expect(config.vrchatIntegration.enabled).toBe(false);
    expect(config.vrchatIntegration.targetPluginId).toBe('osc-bridge');
    expect(config.vrchatIntegration.eventMappings.chat.kind).toBe('chatbox');
  });

  it('emits a VRChat chatbox intent even without a local avatar connection when the bridge is enabled', function() {
    const api = createApi();
    const plugin = new AnimazingPalPlugin(api);
    plugin.config = plugin.normalizeConfig({
      enabled: true,
      vrchatIntegration: {
        enabled: true
      }
    });

    plugin.isConnected = false;
    plugin.brainEngine = null;
    plugin.canTriggerEvent = jest.fn().mockReturnValue(true);
    plugin.evaluateLogicMatrix = jest.fn().mockReturnValue(null);
    plugin.executeAction = jest.fn();
    plugin.recordViewerbaseActivity = jest.fn();
    plugin.sendChatMessage = jest.fn();

    plugin.handleChatEvent({
      uniqueId: 'ViewerOne',
      nickname: 'Viewer One',
      comment: 'Hallo AnimazingPal'
    });

    const intentCall = api.emit.mock.calls.find(([eventName]) => eventName === 'animazingpal:vrchat-intent');
    expect(intentCall).toBeDefined();
    expect(intentCall[1]).toEqual(expect.objectContaining({
      eventType: 'chat',
      kind: 'chatbox',
      username: 'ViewerOne',
      message: 'ViewerOne: Hallo AnimazingPal'
    }));
    expect(plugin.executeAction).not.toHaveBeenCalled();
  });

  it('can suppress brain response forwarding to VRChat when configured off', function() {
    const api = createApi();
    const plugin = new AnimazingPalPlugin(api);
    plugin.config = plugin.normalizeConfig({
      enabled: true,
      vrchatIntegration: {
        enabled: true,
        forwardBrainResponses: false
      }
    });

    plugin.isConnected = false;
    plugin.relayChatMessage('Antwort', {
      eventType: 'brainResponse',
      username: 'ViewerOne'
    });

    expect(api.emit).not.toHaveBeenCalledWith('animazingpal:vrchat-intent', expect.anything());
  });
});
