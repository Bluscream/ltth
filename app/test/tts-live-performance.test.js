const TTSPlugin = require('../plugins/tts/main');

describe('TTS live performance safeguards', () => {
  test('skips live chat synthesis when no callable chat TTS engine exists', async () => {
    let chatHandler;
    const plugin = Object.create(TTSPlugin.prototype);

    plugin.api = {
      registerTikTokEvent: jest.fn((event, handler) => {
        if (event === 'chat') chatHandler = handler;
      })
    };
    plugin.config = { enabledForChat: true };
    plugin.startupTimestamp = '2026-01-01T00:00:00.000Z';
    plugin._logDebug = jest.fn();
    plugin.logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
    plugin._hasCallableChatTtsPath = jest.fn(() => false);
    plugin._logChatTtsUnavailable = jest.fn();
    plugin.speak = jest.fn();

    plugin._registerTikTokEvents();
    await chatHandler({
      timestamp: '2026-01-01T00:00:01.000Z',
      message: 'hello',
      username: 'viewer1',
      teamMemberLevel: 0
    });

    expect(plugin._hasCallableChatTtsPath).toHaveBeenCalled();
    expect(plugin._logChatTtsUnavailable).toHaveBeenCalledWith({
      source: 'chat',
      username: 'viewer1'
    });
    expect(plugin.logger.info).not.toHaveBeenCalled();
    expect(plugin.speak).not.toHaveBeenCalled();
  });

  test('keeps debug entries in memory without writing every debug event to app logs by default', () => {
    const emit = jest.fn();
    const logger = { info: jest.fn() };
    const plugin = {
      debugEnabled: true,
      debugLogs: [],
      maxDebugLogs: 10,
      api: { emit },
      logger,
      config: { debugToLogger: false }
    };

    TTSPlugin.prototype._logDebug.call(plugin, 'TIKTOK_EVENT', 'Chat event received', {
      username: 'viewer1'
    });

    expect(plugin.debugLogs).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith('tts:debug', expect.objectContaining({
      category: 'TIKTOK_EVENT',
      message: 'Chat event received'
    }));
    expect(logger.info).not.toHaveBeenCalled();
  });
});
