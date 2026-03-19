const path = require('path');
const EventEmitter = require('events');
const CommandParser = require('./lib/command-parser');
const QueueManager = require('./lib/queue-manager');
const MusicResolver = require('./lib/music-resolver');
const PlaybackEngine = require('./lib/playback-engine');
const BanList = require('./lib/ban-list');

const DEFAULT_CONFIG = {
  enabled: true,
  commandPrefix: '!',
  commands: {
    request: 'sr',
    skip: 'skip',
    queue: 'queue',
    nowPlaying: 'np',
    volume: 'vol',
    pause: 'pause',
    resume: 'resume',
    clear: 'clear'
  },
  commandAliases: {
    request: ['play', 'song', 'request'],
    skip: [],
    queue: ['q', 'list'],
    nowPlaying: ['now', 'playing', 'current'],
    volume: ['v', 'volume'],
    pause: ['stop'],
    resume: ['unpause', 'continue'],
    clear: []
  },
  queue: {
    maxLength: 50,
    maxPerUser: 3,
    maxSongDurationSeconds: 600,
    allowDuplicates: false,
    cooldownPerUserSeconds: 30
  },
  playback: {
    defaultVolume: 50,
    mpvPath: 'mpv',
    audioDevice: 'auto',
    autoPlay: true,
    crossfadeDuration: 3000
  },
  permissions: {
    request: 'viewer',
    skip: 'viewer',
    volume: 'mod',
    pause: 'mod',
    resume: 'mod',
    clear: 'streamer'
  },
  voteSkip: {
    enabled: true,
    thresholdPercent: 50,
    minVotes: 3
  },
  resolver: {
    ytdlpPath: 'yt-dlp',
    searchTimeout: 15000,
    maxCacheSizeMB: 2048,
    cacheTTLDays: 30
  }
};

class MusicBotPlugin extends EventEmitter {
  constructor(api) {
    super();
    this.api = api;
    this.io = api.getSocketIO();
    this.db = api.getDatabase();

    this.config = { ...DEFAULT_CONFIG };
    this.banList = null;
    this.queueManager = null;
    this.musicResolver = null;
    this.playbackEngine = null;
    this.commandParser = null;

    this.voteSkipState = {
      voters: new Set(),
      required: DEFAULT_CONFIG.voteSkip.minVotes
    };
  }

  async init() {
    this._loadConfig();
    this.api.ensurePluginDataDir();

    this.queueManager = new QueueManager(this.config.queue, this.api);
    this.musicResolver = new MusicResolver(this.config.resolver, this.api);
    this.playbackEngine = new PlaybackEngine(this.config.playback, this.api);
    this.banList = new BanList();

    this.commandParser = new CommandParser(
      this.config,
      this.queueManager,
      this.playbackEngine,
      this.musicResolver,
      this.api,
      this.banList,
      (payload) => this._handleChatResponse(payload)
    );

    this._registerPlaybackEvents();
    this._registerRoutes();
    this._registerSocketEvents();
    this._registerTikTokEvents();

    await this._restoreState();
    this.api.log('[music-bot] Plugin initialized', 'info');
  }

  async destroy() {
    try {
      await this.playbackEngine.shutdown();
    } catch (error) {
      this.api.log(`[music-bot] Failed to shutdown playback: ${error.message}`, 'error');
    }

    this.queueManager.clear();
    this.voteSkipState.voters.clear();
    this.removeAllListeners();
    this.api.log('[music-bot] Plugin destroyed', 'info');
  }

  // ---------- Initialization helpers ----------

  _loadConfig() {
    const saved = this.api.getConfig('config');
    const merged = this._mergeDeep(DEFAULT_CONFIG, saved || {});
    this.config = merged;
    if (!saved) {
      this.api.setConfig('config', merged);
    } else if (JSON.stringify(saved) !== JSON.stringify(merged)) {
      // Ensure new defaults are persisted
      this.api.setConfig('config', merged);
    }
  }

  _mergeDeep(target, source) {
    if (!source || typeof source !== 'object') {
      return target;
    }

    const output = Array.isArray(target) ? [...target] : { ...target };
    Object.keys(source).forEach((key) => {
      const sourceVal = source[key];
      if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
        output[key] = this._mergeDeep(target[key] || {}, sourceVal);
      } else {
        output[key] = sourceVal;
      }
    });
    return output;
  }

  async _restoreState() {
    // Future: restore queue/history from persistent store. For now, broadcast empty state.
    this._emitStatus();
    this._emitQueue();
  }

  _registerPlaybackEvents() {
    this.playbackEngine.on('track-start', (track) => {
      this.queueManager.markPlaying(track);
      this._emitNowPlaying(track);
    });

    this.playbackEngine.on('track-end', (info) => {
      this.queueManager.addToHistory(info.track);
      this.voteSkipState.voters.clear();
      this._playNextFromQueue();
    });

    this.playbackEngine.on('volume-changed', (volume) => {
      this._emitVolume(volume);
    });

    this.playbackEngine.on('error', (error) => {
      this._emitError(error.message || error);
    });
  }

  _registerRoutes() {
    const uiPath = path.join(__dirname, 'ui.html');
    const assetsPath = path.join(__dirname, 'assets');

    this.api.registerRoute('get', '/plugins/music-bot/ui', async (req, res) => {
      res.sendFile(uiPath);
    });

    this.api.registerRoute('get', '/plugins/music-bot/assets/ui-style.css', async (req, res) => {
      res.sendFile(path.join(assetsPath, 'ui-style.css'));
    });

    this.api.registerRoute('get', '/plugins/music-bot/assets/ui.js', async (req, res) => {
      res.sendFile(path.join(assetsPath, 'ui.js'));
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/status', async (req, res) => {
      res.json(this._buildStatusPayload());
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/queue', async (req, res) => {
      res.json({
        success: true,
        queue: this.queueManager.getQueue()
      });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/request', async (req, res) => {
      const { query, username = 'dashboard' } = req.body || {};
      if (!query) {
        res.status(400).json({ success: false, error: 'Missing query' });
        return;
      }
      const result = await this._handleDashboardRequest(query, username);
      res.status(result.success ? 200 : 400).json(result);
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/skip', async (req, res) => {
      const skipped = await this._skipCurrent('dashboard');
      res.status(skipped.success ? 200 : 400).json(skipped);
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/volume', async (req, res) => {
      const { volume } = req.body || {};
      if (typeof volume !== 'number' || volume < 0 || volume > 100) {
        res.status(400).json({ success: false, error: 'Volume must be 0-100' });
        return;
      }
      await this.playbackEngine.setVolume(volume);
      res.json({ success: true, volume });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/pause', async (req, res) => {
      await this.playbackEngine.pause();
      res.json({ success: true });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/resume', async (req, res) => {
      await this.playbackEngine.resume();
      res.json({ success: true });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/clear', async (req, res) => {
      this.queueManager.clear();
      await this.playbackEngine.stop();
      this._emitQueue();
      res.json({ success: true });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/config', async (req, res) => {
      res.json({ success: true, config: this.config });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/config', async (req, res) => {
      const update = req.body || {};
      this.config = this._mergeDeep(this.config, update);
      await this.api.setConfig('config', this.config);
      res.json({ success: true, config: this.config });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/history', async (req, res) => {
      res.json({ success: true, history: this.queueManager.getHistory() });
    });
  }

  _registerSocketEvents() {
    this.api.registerSocket('musicbot:request-status', async (socket) => {
      socket.emit('musicbot:now-playing', this.playbackEngine.getNowPlaying());
      socket.emit('musicbot:queue-update', {
        queue: this.queueManager.getQueue(),
        length: this.queueManager.getQueue().length
      });
      socket.emit('musicbot:volume-changed', { volume: this.playbackEngine.getVolume() });
    });

    this.api.registerSocket('musicbot:dashboard-skip', async () => {
      await this._skipCurrent('dashboard-socket');
    });

    this.api.registerSocket('musicbot:dashboard-volume', async (socket, payload) => {
      const vol = Number(payload?.volume);
      if (Number.isFinite(vol) && vol >= 0 && vol <= 100) {
        await this.playbackEngine.setVolume(vol);
        this._emitVolume(vol);
      } else {
        socket.emit('musicbot:error', { message: 'Volume must be between 0 and 100' });
      }
    });

    this.api.registerSocket('musicbot:dashboard-pause', async () => {
      await this.playbackEngine.pause();
      this._emitPaused();
    });

    this.api.registerSocket('musicbot:dashboard-resume', async () => {
      await this.playbackEngine.resume();
      this._emitResumed();
    });
  }

  _registerTikTokEvents() {
    this.api.registerTikTokEvent('chat', async (data) => {
      await this.commandParser.parse(data, (command) => this._handleCommand(command, data));
    });
  }

  // ---------- Command handling ----------

  async _handleCommand(command, chatData) {
    switch (command.type) {
      case 'request':
        return this._handleRequest(command.query, chatData.username || 'unknown');
      case 'skip':
        return this._handleSkipVote(chatData.username || 'viewer');
      case 'queue':
        this._emitChatResponse(`Queue length: ${this.queueManager.getQueue().length}`, chatData.username);
        return;
      case 'nowPlaying':
        this._emitChatResponse(this._formatNowPlaying(), chatData.username);
        return;
      case 'volume':
        if (command.value !== undefined) {
          await this.playbackEngine.setVolume(command.value);
          this._emitVolume(command.value);
        } else {
          this._emitChatResponse(`Aktuelle Lautstärke: ${this.playbackEngine.getVolume()}`, chatData.username);
        }
        return;
      case 'pause':
        await this.playbackEngine.pause();
        this._emitPaused();
        return;
      case 'resume':
        await this.playbackEngine.resume();
        this._emitResumed();
        return;
      case 'clear':
        this.queueManager.clear();
        await this.playbackEngine.stop();
        this._emitQueue();
        return;
      default:
        break;
    }
  }

  async _handleDashboardRequest(query, username) {
    try {
      const song = await this.musicResolver.resolve(query);
      const added = this.queueManager.addSong({ ...song, requestedBy: username });
      if (!added.success) {
        return added;
      }
      this._emitSongAdded(added.song, added.position);
      if (!this.playbackEngine.isPlaying() && this.config.playback.autoPlay) {
        await this._playNextFromQueue();
      }
      return { success: true, song: added.song, position: added.position };
    } catch (error) {
      this.api.log(`[music-bot] Failed to request song: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async _handleRequest(query, username) {
    if (!query) {
      this._emitChatResponse('Bitte gib einen Song an.', username);
      return;
    }
    if (this.banList.isUserBanned(username) || this.banList.matchesKeyword(query)) {
      this._emitChatResponse('Dieser Song ist nicht erlaubt.', username);
      return;
    }

    try {
      const song = await this.musicResolver.resolve(query);
      if (!song) {
        this._emitChatResponse('Kein Ergebnis gefunden.', username);
        return;
      }
      const addResult = this.queueManager.addSong({ ...song, requestedBy: username });
      if (!addResult.success) {
        this._emitChatResponse(addResult.error || 'Song konnte nicht hinzugefügt werden.', username);
        return;
      }
      this._emitSongAdded(addResult.song, addResult.position);

      if (!this.playbackEngine.isPlaying() && this.config.playback.autoPlay) {
        await this._playNextFromQueue();
      }

      this._emitChatResponse(`Hinzugefügt: ${song.title} (#${addResult.position})`, username);
    } catch (error) {
      this.api.log(`[music-bot] request failed: ${error.message}`, 'error');
      this._emitChatResponse('Song konnte nicht geladen werden.', username);
    }
  }

  async _handleSkipVote(username) {
    if (!this.config.voteSkip.enabled) {
      await this._skipCurrent(username);
      return;
    }

    if (this.voteSkipState.voters.has(username)) {
      this._emitChatResponse('Du hast bereits für Skip gestimmt.', username);
      return;
    }

    this.voteSkipState.voters.add(username);
    const required = this._computeRequiredVotes();
    this._emitVoteSkipUpdate(required);

    if (this.voteSkipState.voters.size >= required) {
      await this._skipCurrent(username);
      this.voteSkipState.voters.clear();
    } else {
      this._emitChatResponse(
        `Skip-Votes: ${this.voteSkipState.voters.size}/${required}`,
        username
      );
    }
  }

  _computeRequiredVotes() {
    const base = Math.max(this.config.voteSkip.minVotes, 1);
    const threshold = Math.ceil((this.config.voteSkip.thresholdPercent / 100) * base);
    const required = Math.max(base, threshold);
    this.voteSkipState.required = required;
    return required;
  }

  async _skipCurrent(reasonUser) {
    const current = this.playbackEngine.getNowPlaying();
    if (!current) {
      return { success: false, error: 'Nothing is playing' };
    }
    await this.playbackEngine.skip();
    this._emitSongSkipped(current.title, reasonUser || 'skip');
    return { success: true };
  }

  async _playNextFromQueue() {
    const next = this.queueManager.shiftNext();
    if (!next) {
      this.playbackEngine.clearNowPlaying();
      this._emitPlaybackStopped();
      this._emitQueue();
      return;
    }
    try {
      await this.playbackEngine.play(next);
      this._emitQueue();
    } catch (error) {
      this.api.log(`[music-bot] Playback failed: ${error.message}`, 'error');
      this._emitError(error.message);
      this._playNextFromQueue();
    }
  }

  // ---------- Emitters ----------

  _emitStatus() {
    this.api.emit('musicbot:now-playing', this.playbackEngine.getNowPlaying());
    this._emitQueue();
    this._emitVolume(this.playbackEngine.getVolume());
  }

  _emitQueue() {
    this.api.emit('musicbot:queue-update', {
      queue: this.queueManager.getQueue(),
      length: this.queueManager.getQueue().length
    });
  }

  _emitSongAdded(song, position) {
    this.api.emit('musicbot:song-added', {
      title: song.title,
      requestedBy: song.requestedBy,
      position,
      duration: song.duration
    });
    this._emitQueue();
  }

  _emitSongSkipped(title, reason) {
    this.api.emit('musicbot:song-skipped', {
      title,
      reason
    });
  }

  _emitVolume(volume) {
    this.api.emit('musicbot:volume-changed', { volume });
  }

  _emitPaused() {
    this.api.emit('musicbot:paused', {});
  }

  _emitResumed() {
    this.api.emit('musicbot:resumed', {});
  }

  _emitPlaybackStopped() {
    this.api.emit('musicbot:playback-stopped', {});
  }

  _emitError(message) {
    this.api.emit('musicbot:error', { message });
  }

  _emitNowPlaying(track) {
    const payload = track || this.playbackEngine.getNowPlaying();
    this.api.emit('musicbot:now-playing', payload);
  }

  _emitVoteSkipUpdate(required) {
    this.api.emit('musicbot:vote-skip-update', {
      votes: this.voteSkipState.voters.size,
      required,
      voters: Array.from(this.voteSkipState.voters)
    });
  }

  _emitChatResponse(message, username) {
    this.api.emit('musicbot:chat-response', { message, username });
  }

  _handleChatResponse(payload) {
    if (payload?.message) {
      this._emitChatResponse(payload.message, payload.username);
    }
  }

  _buildStatusPayload() {
    return {
      success: true,
      nowPlaying: this.playbackEngine.getNowPlaying(),
      queueLength: this.queueManager.getQueue().length,
      volume: this.playbackEngine.getVolume(),
      playbackState: this.playbackEngine.getState()
    };
  }

  _formatNowPlaying() {
    const current = this.playbackEngine.getNowPlaying();
    if (!current) {
      return 'Aktuell läuft nichts.';
    }
    return `Jetzt läuft: ${current.title} (${current.duration || '?'}s)`;
  }
}

module.exports = MusicBotPlugin;
