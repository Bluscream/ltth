const path = require('path');
const EventEmitter = require('events');
const CommandParser = require('./lib/command-parser');
const QueueManager = require('./lib/queue-manager');
const MusicResolver = require('./lib/music-resolver');
const PlaybackEngine = require('./lib/playback-engine');
const BanList = require('./lib/ban-list');
const AutoDJ = require('./lib/auto-dj');

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
    cooldownPerUserSeconds: 30,
    duplicateDetection: 'strict',
    cooldownBypassForGifts: false
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
  giftIntegration: {
    skipImmunityGifts: []
  },
  autoDJ: {
    enabled: false,
    mode: 'history',
    historyMinPlays: 2,
    historyShuffled: true,
    maxConsecutiveAutoDJ: 10,
    announceAutoDJ: true,
    randomKeywords: ['lofi hip hop', 'chill music', 'gaming music', 'pop hits'],
    playlistUrls: []
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
    this.playbackSyncTimer = null;

    this.config = { ...DEFAULT_CONFIG };
    this.banList = null;
    this.queueManager = null;
    this.musicResolver = null;
    this.playbackEngine = null;
    this.commandParser = null;
    this.autoDJ = null;
  }

  async init() {
    this._loadConfig();
    this.api.ensurePluginDataDir();

    this.queueManager = new QueueManager(this.config, this.api);
    this.musicResolver = new MusicResolver(this.config.resolver, this.api);
    this.playbackEngine = new PlaybackEngine(this.config.playback, this.api);
    this.banList = new BanList();
    this.autoDJ = new AutoDJ(this.config.autoDJ, this.musicResolver, this.db, this.api);

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
    this._startPlaybackSync();

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
    this.removeAllListeners();
    if (this.playbackSyncTimer) {
      clearInterval(this.playbackSyncTimer);
      this.playbackSyncTimer = null;
    }
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

  _validateCommandAliases(config) {
    const commandNames = new Map();
    Object.entries(config.commands || {}).forEach(([type, value]) => {
      if (!value) return;
      commandNames.set(String(value).toLowerCase(), type);
    });

    const sanitizedAliases = {};
    try {
      Object.entries(config.commandAliases || {}).forEach(([type, aliases]) => {
        const unique = new Set();
        (aliases || []).forEach((aliasRaw) => {
          const alias = String(aliasRaw || '').trim().toLowerCase();
          if (!alias) return;
          if (commandNames.has(alias) && commandNames.get(alias) !== type) {
            throw new Error(`Alias "${alias}" conflicts with another command`);
          }
          if (unique.has(alias)) {
            return;
          }
          if (Object.values(sanitizedAliases).some((arr) => arr?.includes(alias))) {
            throw new Error(`Alias "${alias}" is already in use`);
          }
          unique.add(alias);
        });
        sanitizedAliases[type] = Array.from(unique);
      });
      Object.keys(config.commands || {}).forEach((cmd) => {
        if (!sanitizedAliases[cmd]) {
          sanitizedAliases[cmd] = [];
        }
      });
    } catch (error) {
      return { valid: false, error: error.message };
    }

    config.commandAliases = sanitizedAliases;
    return { valid: true };
  }

  async _restoreState() {
    // Future: restore queue/history from persistent store. For now, broadcast empty state.
    this._emitStatus();
    this._emitQueue();
  }

  _registerPlaybackEvents() {
    this.playbackEngine.on('track-start', (track) => {
      this.queueManager.markPlaying(track);
      this.queueManager.resetVoteSkips();
      this._emitNowPlaying(track);
    });

    this.playbackEngine.on('track-end', (info) => {
      this.queueManager.addToHistory(info.track, info.reason === 'skip');
      if (info.track?.requestedBy) {
        this.queueManager.removeSkipImmunity(info.track.requestedBy);
      }
      this.queueManager.resetVoteSkips();
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
    const overlayPath = path.join(__dirname, 'overlay.html');

    this.api.registerRoute('get', '/plugins/music-bot/ui', async (req, res) => {
      res.sendFile(uiPath);
    });

    this.api.registerRoute('get', '/plugins/music-bot/assets/ui-style.css', async (req, res) => {
      res.sendFile(path.join(assetsPath, 'ui-style.css'));
    });

    this.api.registerRoute('get', '/plugins/music-bot/assets/ui.js', async (req, res) => {
      res.sendFile(path.join(assetsPath, 'ui.js'));
    });

    this.api.registerRoute('get', '/plugins/music-bot/overlay', async (req, res) => {
      res.sendFile(overlayPath);
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
      this.autoDJ?.reset();
      this._emitQueue();
      res.json({ success: true });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/config', async (req, res) => {
      res.json({ success: true, config: this.config });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/config', async (req, res) => {
      const update = req.body || {};
      const merged = this._mergeDeep(this.config, update);
      const aliasValidation = this._validateCommandAliases(merged);
      if (!aliasValidation.valid) {
        res.status(400).json({ success: false, error: aliasValidation.error });
        return;
      }
      this.config = merged;
      this.queueManager.config = merged;
      this.queueManager.queueConfig = merged.queue;
      this.playbackEngine.config = merged.playback;
      this.autoDJ?.updateConfig(merged.autoDJ);
      await this.api.setConfig('config', this.config);
      res.json({ success: true, config: this.config });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/history', async (req, res) => {
      res.json({ success: true, history: this.queueManager.getHistory() });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/auto-dj/status', async (req, res) => {
      res.json({ success: true, status: this.autoDJ?.getStatus() });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/auto-dj/toggle', async (req, res) => {
      const payload = req.body || {};
      this.config.autoDJ = this._mergeDeep(this.config.autoDJ, payload);
      this.autoDJ?.updateConfig(this.config.autoDJ);
      await this.api.setConfig('config', this.config);
      res.json({ success: true, status: this.autoDJ?.getStatus() });
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/auto-dj/skip', async (req, res) => {
      const next = await this._maybePlayAutoDJ(true);
      res.json({ success: Boolean(next), track: next || null });
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
    this.api.registerTikTokEvent('gift', async (data) => {
      await this._handleGiftEvent(data);
    });
  }

  // ---------- Command handling ----------

  async _handleCommand(command, chatData) {
    switch (command.type) {
      case 'request':
        return this._handleRequest(command.query, chatData.username || 'unknown');
      case 'skip':
        if (command.force) {
          return this._skipCurrent(chatData.username || 'viewer');
        }
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
        this.autoDJ?.reset();
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
      this.autoDJ?.onSongRequested();
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
      this.autoDJ?.onSongRequested();
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

    const voteResult = this.queueManager.addVoteSkip(username);
    if (voteResult.duplicateVote) {
      this._emitChatResponse('Du hast bereits für Skip gestimmt.', username);
      return;
    }

    this._emitVoteSkipUpdate(voteResult);

    if (voteResult.immuneInfo) {
      this._emitChatResponse(
        `⛔ Dieser Song hat Skip-Immunität! (@${voteResult.immuneInfo.requestedBy} hat mit einem Gift requested)`,
        username
      );
      return;
    }

    if (voteResult.skipped) {
      await this._skipCurrent(username);
      this.queueManager.resetVoteSkips();
    } else {
      this._emitChatResponse(
        `Skip-Votes: ${voteResult.votes}/${voteResult.required}`,
        username
      );
    }
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
      const autoDJTrack = await this._maybePlayAutoDJ();
      if (!autoDJTrack) {
        this.playbackEngine.clearNowPlaying();
        this._emitPlaybackStopped();
        this._emitQueue();
      }
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

  _emitVoteSkipUpdate(result) {
    this.api.emit('musicbot:vote-skip-update', {
      votes: result.votes,
      required: result.required,
      voters: this.queueManager.getVoteVoters(),
      title: this.playbackEngine.getNowPlaying()?.title || null,
      immuneInfo: result.immuneInfo
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

  async _handleGiftEvent(data) {
    const gifts = (this.config.giftIntegration?.skipImmunityGifts || []).map((g) =>
      String(g || '').toLowerCase().trim()
    );
    if (!gifts.length) return;

    const giftName = String(
      data?.gift?.name || data?.giftName || data?.giftId || data?.id || ''
    ).toLowerCase();
    if (!giftName) return;

    const match = gifts.find((entry) => String(entry || '').toLowerCase() === giftName);
    if (!match) return;

    const username =
      data?.username || data?.nickname || data?.user?.uniqueId || data?.user?.nickname;
    if (!username) return;

    const hasSong = this._findSongByUser(username);
    if (!hasSong) return;

    hasSong.isGiftRequest = true;
    this.queueManager.addSkipImmunity(username);
    this.api.emit('musicbot:skip-immunity-granted', { username, giftName: match });
    this._emitChatResponse(`${username} hat Skip-Immunity erhalten (${match}).`, username);
  }

  _findSongByUser(username) {
    const lower = String(username || '').toLowerCase();
    if (!lower) return null;
    const current = this.playbackEngine.getNowPlaying();
    if (current?.requestedBy?.toLowerCase() === lower) {
      return current;
    }
    return this.queueManager.getQueue().find((item) => item.requestedBy?.toLowerCase() === lower);
  }

  async _maybePlayAutoDJ(force = false) {
    if (!this.autoDJ || !this.config.autoDJ?.enabled) {
      return null;
    }

    const result = force ? await this.autoDJ.getNextSong(true) : await this.autoDJ.onQueueEmpty();
    if (!result) return null;

    const track = result.song || result;
    try {
      await this.playbackEngine.play(track);
      this.queueManager.markPlaying(track);
      this._emitQueue();
      this.api.emit('musicbot:auto-dj-playing', {
        title: track.title,
        mode: this.autoDJ.getStatus().mode
      });
      if (result.announce && this.config.autoDJ.announceAutoDJ) {
        this._emitChatResponse(`AutoDJ spielt: ${track.title}`, 'AutoDJ');
      }
      return track;
    } catch (error) {
      this.api.log(`[music-bot] AutoDJ playback failed: ${error.message}`, 'error');
      return null;
    }
  }

  _buildStatusPayload() {
    return {
      success: true,
      nowPlaying: this.playbackEngine.getNowPlaying(),
      queueLength: this.queueManager.getQueue().length,
      volume: this.playbackEngine.getVolume(),
      playbackState: this.playbackEngine.getState(),
      autoDJ: this.autoDJ?.getStatus()
    };
  }

  _formatNowPlaying() {
    const current = this.playbackEngine.getNowPlaying();
    if (!current) {
      return 'Aktuell läuft nichts.';
    }
    return `Jetzt läuft: ${current.title} (${current.duration || '?'}s)`;
  }

  _startPlaybackSync() {
    if (this.playbackSyncTimer) {
      clearInterval(this.playbackSyncTimer);
    }
    this.playbackSyncTimer = setInterval(() => {
      const nowPlaying = this.playbackEngine.getNowPlaying();
      if (!nowPlaying) return;
      const elapsed = nowPlaying.startedAt ? Math.max(0, Math.floor((Date.now() - nowPlaying.startedAt) / 1000)) : null;
      this.api.emit('musicbot:playback-sync', {
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        requestedBy: nowPlaying.requestedBy,
        thumbnail: nowPlaying.thumbnail,
        duration: nowPlaying.duration,
        position: elapsed,
        startedAt: nowPlaying.startedAt,
        state: this.playbackEngine.getState()
      });
    }, 5000);
  }
}

module.exports = MusicBotPlugin;
