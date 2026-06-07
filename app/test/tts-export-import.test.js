const Database = require('better-sqlite3');
const TTSPlugin = require('../plugins/tts/main');

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
};

class MockDatabase {
  constructor() {
    this.db = new Database(':memory:');
    this.db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    this.setSetting('tts_enabled', 'true');
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  }

  close() {
    this.db.close();
  }
}

class MockAPI {
  constructor(db) {
    this.db = db;
    this.logger = mockLogger;
    this.config = {};
    this.routes = [];
  }

  getDatabase() {
    return this.db;
  }

  getConfig(key) {
    return this.config[key];
  }

  setConfig(key, value) {
    this.config[key] = value;
    return true;
  }

  emit() {}
  registerSocket() {}
  registerTikTokEvent() {}

  registerRoute(method, routePath, handler) {
    this.routes.push({ method, path: routePath, handler });
  }
}

describe('TTS export/import', () => {
  let db;
  let api;
  let plugin;

  beforeEach(() => {
    jest.clearAllMocks();
    db = new MockDatabase();
    api = new MockAPI(db);
    plugin = new TTSPlugin(api);
  });

  afterEach(async () => {
    if (plugin) {
      await plugin.destroy();
    }
    db.close();
  });

  test('export payload includes config, event rules, and users without API keys', () => {
    plugin.config.openaiApiKey = 'secret-openai-key';
    plugin.config.eventTTS.enabled = true;
    plugin.permissionManager.assignVoice('u1', 'UserOne', 'de_002', 'tiktok', 'happy', 1.25);

    const payload = plugin._buildExportPayload();

    expect(payload.version).toBe(1);
    expect(payload.config.eventTTS.enabled).toBe(true);
    expect(payload.config.openaiApiKey).toBeUndefined();
    expect(payload.users).toHaveLength(1);
    expect(payload.users[0]).toMatchObject({
      user_id: 'u1',
      username: 'UserOne',
      assigned_voice_id: 'de_002',
      assigned_engine: 'tiktok',
      voice_emotion: 'happy',
      volume_gain: 1.25
    });
  });

  test('import applies config and user voice assignments but ignores API keys', () => {
    plugin.config.openaiApiKey = 'existing-key';

    const result = plugin._importExportPayload({
      version: 1,
      config: {
        defaultEngine: 'tiktok',
        defaultVoice: 'de_001',
        openaiApiKey: 'imported-secret',
        eventTTS: {
          enabled: true,
          volume: 70,
          events: {
            follow: {
              enabled: true,
              template: '{username} followed',
              cooldownSeconds: 1
            }
          }
        }
      },
      users: [
        {
          user_id: 'u2',
          username: 'UserTwo',
          allow_tts: 1,
          assigned_voice_id: 'en_us_001',
          assigned_engine: 'tiktok',
          lang_preference: 'en',
          volume_gain: 1.5,
          voice_emotion: 'cheerful',
          is_blacklisted: 0
        }
      ]
    });

    expect(result).toMatchObject({
      success: true,
      importedUsers: 1
    });
    expect(plugin.config.defaultVoice).toBe('de_001');
    expect(plugin.config.eventTTS.enabled).toBe(true);
    expect(plugin.config.openaiApiKey).toBe('existing-key');
    expect(plugin.permissionManager.getUserSettings('u2')).toMatchObject({
      username: 'UserTwo',
      assigned_voice_id: 'en_us_001',
      assigned_engine: 'tiktok',
      volume_gain: 1.5,
      voice_emotion: 'cheerful'
    });
  });

  test('init registers export and import API routes', async () => {
    await plugin.init();

    expect(api.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/tts/export' }),
      expect.objectContaining({ method: 'POST', path: '/api/tts/import' })
    ]));
  });
});
