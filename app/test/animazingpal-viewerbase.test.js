const assert = require('assert');
const AnimazingPalPlugin = require('../plugins/animazingpal/main');

function createApiStub() {
  return {
    getSocketIO() {
      return { emit() {} };
    },
    getDatabase() {
      return {};
    },
    log() {},
    registerRoute() {},
    emit() {},
    setConfig() {},
    getConfig() {
      return null;
    }
  };
}

function createViewerbaseMemoryDb() {
  return {
    getStreamerId() {
      return 'streamer-1';
    },
    getStatistics() {
      return {
        streamerId: 'streamer-1',
        totalUsers: 2,
        totalMemories: 3,
        totalConversations: 4,
        totalArchives: 1
      };
    },
    getTopSupporters(limit) {
      return [
        {
          username: 'max_supporter',
          nickname: 'Max',
          total_diamonds: 500,
          gift_count: 12,
          stream_count: 4
        }
      ].slice(0, limit);
    },
    getFrequentChatters(limit) {
      return [
        {
          username: 'chatty_viewer',
          nickname: 'Chatty',
          interaction_count: 15,
          stream_count: 6,
          last_topic: 'gaming'
        }
      ].slice(0, limit);
    },
    getRecentMemories(limit) {
      return [
        {
          memory_type: 'chat',
          content: 'hello there',
          tags: '["chat","welcome"]',
          context: '{"mood":"happy"}',
          created_at: '2026-01-01T12:00:00.000Z',
          source_user: 'chatty_viewer',
          importance: 0.7
        }
      ].slice(0, limit);
    },
    getStreamerProfiles() {
      return [{ streamerId: 'streamer-1', memoryCount: 3 }];
    }
  };
}

describe('AnimazingPal Viewerbase', function() {
  it('builds a viewerbase snapshot from the memory database', function() {
    const plugin = new AnimazingPalPlugin(createApiStub());
    plugin.config = plugin.normalizeConfig({
      viewerbase: {
        enabled: true,
        showInUI: true,
        recentLimit: 12,
        supporterLimit: 10,
        chatterLimit: 10,
        externalSync: {
          enabled: false,
          endpointUrl: '',
          authToken: ''
        }
      }
    });
    plugin.brainEngine = {
      memoryDb: createViewerbaseMemoryDb()
    };

    const snapshot = plugin.buildViewerbaseSnapshot();

    assert.strictEqual(snapshot.streamerId, 'streamer-1');
    assert.strictEqual(snapshot.viewerCounts.totalUsers, 2);
    assert.strictEqual(snapshot.topSupporters[0].displayName, 'Max');
    assert.strictEqual(snapshot.frequentChatters[0].displayName, 'Chatty');
    assert.deepStrictEqual(snapshot.recentMemories[0].tags, ['chat', 'welcome']);
    assert.deepStrictEqual(snapshot.recentMemories[0].context, { mood: 'happy' });
  });

  it('sanitizes the external viewerbase auth token in safe config output', function() {
    const plugin = new AnimazingPalPlugin(createApiStub());
    plugin.config = plugin.normalizeConfig({
      viewerbase: {
        enabled: true,
        externalSync: {
          enabled: true,
          endpointUrl: 'https://viewerbase.example/sync',
          authToken: 'super-secret',
          timeoutMs: 5000,
          retryLimit: 3
        }
      }
    });

    const safeConfig = plugin.getSafeConfig();

    assert.strictEqual(safeConfig.viewerbase.externalSync.endpointUrl, 'https://viewerbase.example/sync');
    assert.strictEqual(safeConfig.viewerbase.externalSync.authToken, '');
    assert.strictEqual(safeConfig.viewerbase.externalSync.authTokenConfigured, true);
  });

  it('queues a viewerbase sync request when external sync is enabled', function() {
    const plugin = new AnimazingPalPlugin(createApiStub());
    plugin.config = plugin.normalizeConfig({
      viewerbase: {
        enabled: true,
        externalSync: {
          enabled: true,
          endpointUrl: 'https://viewerbase.example/sync',
          authToken: '',
          timeoutMs: 5000,
          retryLimit: 3
        }
      }
    });

    const queued = plugin.scheduleViewerbaseSync('chat', { delayMs: 60000 });
    assert.strictEqual(queued, true);
    assert.ok(plugin.viewerbaseSyncPending, 'viewerbase sync should be queued');
    assert.strictEqual(plugin.viewerbaseSyncPending.reason, 'chat');
    assert.strictEqual(plugin.viewerbaseSyncState.queueLength, 1);

    if (plugin.viewerbaseSyncTimer) {
      clearTimeout(plugin.viewerbaseSyncTimer);
      plugin.viewerbaseSyncTimer = null;
    }
  });
});
