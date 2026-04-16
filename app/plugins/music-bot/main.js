const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { spawn } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');
const { createHash } = require('crypto');
let YOUTUBE_DL_PATH = 'yt-dlp';
try {
  const youtubeDlExec = require('youtube-dl-exec');
  if (youtubeDlExec && youtubeDlExec.constants && youtubeDlExec.constants.YOUTUBE_DL_PATH) {
    YOUTUBE_DL_PATH = youtubeDlExec.constants.YOUTUBE_DL_PATH;
  }
} catch (_e) {
  // youtube-dl-exec not installed — fallback to system yt-dlp
}
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
    clear: 'clear',
    mysong: 'mysong',
    help: 'help',
    remove: 'remove'
  },
  commandAliases: {
    request: ['play', 'song', 'request'],
    skip: [],
    queue: ['q', 'list'],
    nowPlaying: ['now', 'playing', 'current'],
    volume: ['v', 'volume'],
    pause: ['stop'],
    resume: ['unpause', 'continue'],
    clear: [],
    mysong: ['mypos', 'myposition', 'wheremysong'],
    help: ['commands', 'cmds', 'hilfe'],
    remove: ['removesong', 'removemy', 'delsong']
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
    crossfadeDuration: 3000,
    ducking: {
      enabled: true,
      targetVolumePercent: 35,
      fadeOutMs: 250,
      fadeInMs: 700,
      holdMs: 1100
    },
    normalization: {
      enabled: true,
      integratedLufs: -16,
      truePeakDb: -1.5,
      lra: 11
    }
  },
  permissions: {
    request: 'viewer',
    skip: 'viewer',
    volume: 'mod',
    pause: 'mod',
    resume: 'mod',
    clear: 'streamer',
    mysong: 'viewer',
    help: 'viewer',
    remove: 'viewer',
    requireSuperfanForRequest: false
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
    ytdlpPath: process.env.YTDLP_PATH || 'yt-dlp',
    searchTimeout: 15000,
    maxCacheSizeMB: 2048,
    cacheTTLDays: 30
  },
  moderation: {
    rejectExplicit: false,
    rejectAgeRestricted: true,
    blockedKeywords: []
  },
  fallbackPlaylist: {
    enabled: false,
    tracks: []
  },
  preCache: {
    enabled: true,
    lookahead: 2
  }
};

class MusicBotPlugin extends EventEmitter {
  constructor(api) {
    super();
    this.api = api;
    this.io = api.getSocketIO();
    this.db = api.getDatabase();
    this.playbackSyncTimer = null;
    this._mpvRestartAttempts = 0;

    this.config = { ...DEFAULT_CONFIG };
    this.banList = null;
    this.queueManager = null;
    this.musicResolver = null;
    this.playbackEngine = null;
    this.commandParser = null;
    this.autoDJ = null;
    this._pendingRequests = new Set();
    this.pluginDataDir = null;
    this.cacheDir = null;
    this._precacheTasks = new Map();
    this._precacheState = new Map();
    this._fallbackIndex = 0;
    this._ioEmitOriginal = null;
    this._ttsDuckingHandlers = null;
  }

  async init() {
    this._loadConfig();
    this.pluginDataDir = this.api.ensurePluginDataDir();
    this.cacheDir = path.join(this.pluginDataDir, 'cache');
    await fsp.mkdir(this.cacheDir, { recursive: true });

    await this._ensureYtDlp();
    await this._ensureMpv();

    this.queueManager = new QueueManager(this.config, this.api);
    this.musicResolver = new MusicResolver(
      { ...this.config.resolver, moderation: this.config.moderation },
      this.api
    );
    this.playbackEngine = new PlaybackEngine(this.config.playback, this.api);
    this.banList = new BanList(this.api);
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
    this._registerDuckingHooks();

    await this._restoreState();
    this.api.log('[music-bot] Plugin initialized', 'info');

    this._emitSetupStatus();
  }

  async destroy() {
    try {
      await this.playbackEngine.shutdown();
    } catch (error) {
      this.api.log(`[music-bot] Failed to shutdown playback: ${error.message}`, 'error');
    }

    this.queueManager.clear();
    this._cleanupDuckingHooks();
    await this._stopPrecacheTasks();
    this._pendingRequests.clear();
    this.removeAllListeners();
    this._stopPlaybackSync();
    this.api.log('[music-bot] Plugin destroyed', 'info');
  }

  // ---------- Initialization helpers ----------

  _loadConfig() {
    const saved = this.api.getConfig('config');
    const merged = this._mergeDeep(DEFAULT_CONFIG, saved || {});
    this.config = merged;
    this.config.moderation = this._mergeDeep(DEFAULT_CONFIG.moderation, this.config.moderation || {});
    if (!Array.isArray(this.config.moderation.blockedKeywords)) {
      this.config.moderation.blockedKeywords = [];
    }
    if (!saved) {
      this.api.setConfig('config', merged);
    } else if (JSON.stringify(saved) !== JSON.stringify(merged)) {
      // Ensure new defaults are persisted
      this.api.setConfig('config', merged);
    }
  }

  async _ensureYtDlp() {
    const execFileAsync = promisify(execFile);
    const configured = this.config.resolver.ytdlpPath;
    const isDefaultPath = !configured || configured === 'yt-dlp';
    // Use the bundled binary from youtube-dl-exec when no custom path is configured
    const ytdlpPath = isDefaultPath ? YOUTUBE_DL_PATH : configured;

    // Check if yt-dlp is available at the resolved path
    try {
      await execFileAsync(ytdlpPath, ['--version'], { timeout: 5000 });
      this.api.log('[music-bot] yt-dlp found and ready', 'debug');
      this._ytdlpAvailable = true;
      return;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
        // Executable found but errored for another reason – treat as present
        this.api.log('[music-bot] yt-dlp found (version check returned error, but executable exists)', 'debug');
        this._ytdlpAvailable = true;
        return;
      }
    }

    this._ytdlpAvailable = false;

    if (isDefaultPath) {
      this.api.log(
        '[music-bot] yt-dlp not found. Music Bot runs in limited mode (oEmbed fallback only). ' +
        'Install yt-dlp for full functionality: run "npm install youtube-dl-exec" in app/, ' +
        'or download yt-dlp manually and set the path in Music Bot settings.',
        'warn'
      );
    } else {
      this.api.log(
        `[music-bot] yt-dlp not found at configured path "${ytdlpPath}". ` +
        'Please verify the path in Music Bot settings.',
        'warn'
      );
    }
  }

  async _ensureMpv() {
    const execFileAsync = promisify(execFile);
    const mpvPath = this.config.playback.mpvPath || 'mpv';

    try {
      await execFileAsync(mpvPath, ['--version'], { timeout: 5000 });
      this.api.log('[music-bot] mpv found and ready', 'debug');
      this._mpvAvailable = true;
    } catch (err) {
      this._mpvAvailable = false;
      this.api.log(
        `[music-bot] mpv not found at "${mpvPath}". Music playback is disabled. ` +
        'Install mpv (https://mpv.io/installation/) and restart LTTH, ' +
        'or set the correct path in Music Bot settings.',
        'warn'
      );
    }
  }

  _getSetupIssues() {
    const issues = [];
    if (!this._ytdlpAvailable) {
      issues.push({
        id: 'ytdlp-missing',
        severity: 'warning',
        title: 'yt-dlp nicht gefunden',
        description: 'Für YouTube-Suche und Song-Downloads wird yt-dlp benötigt. ' +
          'Ohne yt-dlp funktioniert nur der oEmbed-Fallback (eingeschränkte Metadaten, kein Suchfeld).',
        installInstructions: [
          'npm install youtube-dl-exec (im app/ Verzeichnis)',
          'Oder: yt-dlp manuell von https://github.com/yt-dlp/yt-dlp/releases herunterladen',
          'Oder: Pfad in Music Bot Einstellungen → Resolver → yt-dlp Pfad setzen'
        ]
      });
    }
    if (!this._mpvAvailable) {
      issues.push({
        id: 'mpv-missing',
        severity: 'error',
        title: 'mpv Media Player nicht gefunden',
        description: 'Der Music Bot braucht mpv (https://mpv.io) für die Audio-Wiedergabe. ' +
          'Ohne mpv wird keine Musik abgespielt.',
        installInstructions: [
          'Windows: https://mpv.io/installation/ oder scoop install mpv',
          'Linux: sudo apt install mpv',
          'macOS: brew install mpv',
          'Pfad in Music Bot Einstellungen → Playback → mpv Pfad setzen'
        ]
      });
    }
    return issues;
  }

  _emitSetupStatus() {
    const issues = this._getSetupIssues();
    this.io.emit('music-bot:setup-status', {
      ytdlpAvailable: this._ytdlpAvailable || false,
      mpvAvailable: this._mpvAvailable || false,
      issues
    });
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
    this.queueManager.restoreQueue();
    this._emitStatus();
    this._emitQueue();
    this._schedulePreCache();
  }

  _registerPlaybackEvents() {
    this.playbackEngine.on('track-start', (track) => {
      this.queueManager.markPlaying(track);
      this.queueManager.resetVoteSkips();
      this._emitNowPlaying(track);
      this._mpvRestartAttempts = 0;
      this._startPlaybackSync();
      this._schedulePreCache();
    });

    this.playbackEngine.on('track-end', (info) => {
      this.queueManager.addToHistory(info.track, info.reason === 'skip');
      if (info.track?.requestedBy) {
        this.queueManager.removeSkipImmunity(info.track.requestedBy);
      }
      this.queueManager.resetVoteSkips();
      this._stopPlaybackSync();
      this._playNextFromQueue();
    });

    this.playbackEngine.on('volume-changed', (volume) => {
      this._emitVolume(volume);
    });

    this.playbackEngine.on('error', (error) => {
      this._emitError(error.message || error);
    });

    this.playbackEngine.on('crashed', async () => {
      const current = this.playbackEngine.getNowPlaying();
      this._mpvRestartAttempts += 1;
      if (this._mpvRestartAttempts > 3 || !current) {
        this.api.log('[music-bot] mpv crashed and could not be restarted', 'error');
        this.playbackEngine.clearNowPlaying();
        this._emitPlaybackStopped();
        return;
      }
      this.api.log('[music-bot] mpv crashed, attempting automatic restart', 'warn');
      setTimeout(async () => {
        try {
          await this.playbackEngine.play(current);
        } catch (error) {
          this.api.log(`[music-bot] mpv restart failed: ${error.message}`, 'error');
        }
      }, 2000);
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

    this.api.registerRoute('get', '/api/plugins/music-bot/setup-status', (req, res) => {
      res.json({
        success: true,
        ytdlpAvailable: this._ytdlpAvailable || false,
        mpvAvailable: this._mpvAvailable || false,
        issues: this._getSetupIssues()
      });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/resolve', async (req, res) => {
      const query = req.query?.q || req.query?.query;
      if (!query) {
        res.status(400).json({ success: false, error: 'Missing query' });
        return;
      }
      try {
        const resolved = await this.musicResolver.resolve(query);
        if (!resolved?.success) {
          res.status(400).json(resolved);
          return;
        }

        const banMessage = this._checkBans(resolved.song, 'dashboard');
        if (banMessage) {
          res.status(400).json({ success: false, error: banMessage });
          return;
        }

        res.json({ success: true, song: resolved.song });
      } catch (error) {
        this.api.log(`[music-bot] Resolve failed: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
      }
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
      this.config.moderation = this._mergeDeep(DEFAULT_CONFIG.moderation, this.config.moderation || {});
      if (!Array.isArray(this.config.moderation.blockedKeywords)) {
        this.config.moderation.blockedKeywords = [];
      }
      this.queueManager.config = merged;
      this.queueManager.queueConfig = merged.queue;
      this.playbackEngine.config = merged.playback;
      this.musicResolver.config = { ...this.config.resolver, moderation: this.config.moderation };
      this.autoDJ?.updateConfig(merged.autoDJ);
      await this.api.setConfig('config', this.config);
      res.json({ success: true, config: this.config });
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/history', async (req, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      try {
        const rows = this.db
          .prepare('SELECT * FROM plugin_music_bot_history ORDER BY finishedAt DESC LIMIT ? OFFSET ?')
          .all(limit, offset);
        const total = this.db
          .prepare('SELECT COUNT(*) as count FROM plugin_music_bot_history')
          .get().count;
        res.json({ success: true, history: rows, total, limit, offset });
      } catch (error) {
        this.api.log(`[music-bot] Failed to load history: ${error.message}`, 'error');
        res.json({ success: true, history: this.queueManager.getHistory() });
      }
    });

    this.api.registerRoute('delete', '/api/plugins/music-bot/queue/:index', async (req, res) => {
      const index = Number(req.params.index);
      if (!Number.isFinite(index) || index < 0) {
        res.status(400).json({ success: false, error: 'Invalid index' });
        return;
      }
      const result = this.queueManager.removeSong(index);
      if (result.success) {
        this._emitQueue();
      }
      res.status(result.success ? 200 : 400).json(result);
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/queue/reorder', async (req, res) => {
      const { fromIndex, toIndex } = req.body || {};
      if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
        res.status(400).json({ success: false, error: 'fromIndex and toIndex are required' });
        return;
      }
      const result = this.queueManager.reorderSong(fromIndex, toIndex);
      if (result.success) {
        this._emitQueue();
      }
      res.status(result.success ? 200 : 400).json(result);
    });

    this.api.registerRoute('get', '/api/plugins/music-bot/bans', async (req, res) => {
      try {
        res.json({ success: true, bans: this.banList.getAllBans() });
      } catch (error) {
        this.api.log(`[music-bot] Failed to load bans: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: 'Failed to load bans' });
      }
    });

    this.api.registerRoute('post', '/api/plugins/music-bot/bans', async (req, res) => {
      const { type, value, reason } = req.body || {};
      const validTypes = ['url', 'keyword', 'channel', 'user'];
      if (!validTypes.includes(type) || !value || !String(value).trim()) {
        res.status(400).json({ success: false, error: 'type and value are required' });
        return;
      }
      try {
        const ban = this.banList.addBan(type, String(value).trim(), reason, 'dashboard');
        res.json({ success: true, ban });
      } catch (error) {
        this.api.log(`[music-bot] Failed to add ban: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.api.registerRoute('delete', '/api/plugins/music-bot/bans/:id', async (req, res) => {
      try {
        const id = Number(req.params.id);
        const result = this.banList.removeBan(id);
        res.status(result.success ? 200 : 404).json({ success: result.success });
      } catch (error) {
        this.api.log(`[music-bot] Failed to remove ban: ${error.message}`, 'error');
        res.status(500).json({ success: false, error: 'Failed to remove ban' });
      }
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

  _registerDuckingHooks() {
    const ttsStarted = async () => {
      try {
        await this.playbackEngine?.triggerDucking();
      } catch (error) {
        this.api.log(`[music-bot] TTS ducking failed: ${error.message}`, 'error');
      }
    };
    const alertShown = async () => {
      try {
        await this.playbackEngine?.triggerDucking();
      } catch (error) {
        this.api.log(`[music-bot] Alert ducking failed: ${error.message}`, 'error');
      }
    };

    this._ttsDuckingHandlers = { ttsStarted, alertShown };
    this.api.pluginLoader?.on('tts:playback:started', ttsStarted);

    if (this.io && typeof this.io.emit === 'function') {
      this._ioEmitOriginal = this.io.emit.bind(this.io);
      this.io.emit = (event, ...args) => {
        if (event === 'alert:show') {
          Promise.resolve(alertShown()).catch(() => {});
        }
        return this._ioEmitOriginal(event, ...args);
      };
    }
  }

  _cleanupDuckingHooks() {
    if (this._ttsDuckingHandlers?.ttsStarted) {
      this.api.pluginLoader?.removeListener?.('tts:playback:started', this._ttsDuckingHandlers.ttsStarted);
    }
    if (this._ioEmitOriginal && this.io) {
      this.io.emit = this._ioEmitOriginal;
    }
    this._ioEmitOriginal = null;
    this._ttsDuckingHandlers = null;
  }

  // ---------- Command handling ----------

  async _handleCommand(command, chatData) {
    const username = this._getChatUsername(chatData);
    switch (command.type) {
      case 'request':
        return this._handleRequest(command.query, username);
      case 'skip':
        if (command.force) {
          return this._skipCurrent(username);
        }
        return this._handleSkipVote(username);
      case 'queue':
        this._emitChatResponse(`Queue length: ${this.queueManager.getQueue().length}`, username);
        return;
      case 'nowPlaying':
        this._emitChatResponse(this._formatNowPlaying(), username);
        return;
      case 'volume':
        if (command.value !== undefined) {
          await this.playbackEngine.setVolume(command.value);
          this._emitVolume(command.value);
        } else {
          this._emitChatResponse(`Aktuelle Lautstärke: ${this.playbackEngine.getVolume()}`, username);
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
      case 'mysong': {
        const queue = this.queueManager.getQueue();
        const lowerUser = username.toLowerCase();
        const idx = queue.findIndex(s => (s.requestedBy || '').toLowerCase() === lowerUser);
        if (idx === -1) {
          this._emitChatResponse('Du hast keinen Song in der Queue.', username);
        } else {
          const song = queue[idx];
          this._emitChatResponse(
            `Dein Song "${song.title}" ist auf Position #${idx + 1}.`,
            username
          );
        }
        return;
      }
      case 'help': {
        const prefix = this.config.commandPrefix;
        const cmds = this.config.commands;
        const parts = [];
        if (cmds.request) parts.push(`${prefix}${cmds.request} <song>`);
        if (cmds.skip) parts.push(`${prefix}${cmds.skip}`);
        if (cmds.queue) parts.push(`${prefix}${cmds.queue}`);
        if (cmds.nowPlaying) parts.push(`${prefix}${cmds.nowPlaying}`);
        if (cmds.mysong) parts.push(`${prefix}${cmds.mysong}`);
        if (cmds.remove) parts.push(`${prefix}${cmds.remove}`);
        this._emitChatResponse(`Commands: ${parts.join(' | ')}`, username);
        return;
      }
      case 'remove': {
        const queue = this.queueManager.getQueue();
        const lowerUser = username.toLowerCase();
        const isPrivileged = await this._isPrivilegedUser(username, chatData);

        if (command.index !== null && command.index !== undefined && isPrivileged) {
          // Mod/Streamer: remove specific song by 0-based index
          const result = this.queueManager.removeSong(command.index);
          if (result.success) {
              this._emitChatResponse(
                `"${result.song.title}" wurde aus der Queue entfernt.`,
                username
              );
              this._emitQueue();
            } else {
              this._emitChatResponse('Song nicht gefunden.', username);
            }
          } else {
            // Remove user's own song
            const idx = queue.findIndex(s => (s.requestedBy || '').toLowerCase() === lowerUser);
            if (idx === -1) {
              this._emitChatResponse('Du hast keinen Song in der Queue.', username);
            } else {
              const result = this.queueManager.removeSong(idx);
              if (result.success) {
                this._emitChatResponse(
                  `"${result.song.title}" wurde aus der Queue entfernt.`,
                  username
                );
                this._emitQueue();
              } else {
                this._emitChatResponse('Fehler beim Entfernen.', username);
              }
            }
          }
        return;
      }
      default:
        break;
    }
  }

  _getChatUsername(chatData) {
    return (
      chatData?.username ||
      chatData?.uniqueId ||
      chatData?.nickname ||
      chatData?.user?.uniqueId ||
      chatData?.user?.nickname ||
      'viewer'
    );
  }

  async _isPrivilegedUser(username, chatData) {
    if (chatData?.isModerator === true) return true;
    if (Number.isFinite(chatData?.teamMemberLevel) && chatData.teamMemberLevel >= 1) return true;
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('tiktok_username');
      const streamer = row?.value;
      if (streamer && streamer.toLowerCase() === (username || '').toLowerCase()) return true;
    } catch (_) { /* ignore db errors */ }
    return false;
  }

  async _handleDashboardRequest(query, username) {
    try {
      const resolved = await this.musicResolver.resolve(query);
      if (!resolved?.success) {
        return { success: false, error: resolved?.message || 'Song konnte nicht geladen werden.' };
      }

      const banMessage = this._checkBans(resolved.song, username);
      if (banMessage) {
        return { success: false, error: banMessage };
      }

      const added = this.queueManager.addSong({ ...resolved.song, requestedBy: username });
      if (!added.success) {
        return added;
      }
      this._schedulePreCache();
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

    const lowerUser = username.toLowerCase();
    if (this._pendingRequests.has(lowerUser)) {
      this._emitChatResponse('Dein vorheriger Request wird noch verarbeitet.', username);
      return;
    }

    const userBan = this.banList?.isUserBanned(username);
    if (userBan?.banned) {
      this._emitChatResponse('Dieser Nutzer darf keine Songs anfragen.', username);
      return;
    }

    this._pendingRequests.add(lowerUser);
    try {
      const resolved = await this.musicResolver.resolve(query);
      if (!resolved?.success) {
        this._emitChatResponse(resolved?.message || 'Song konnte nicht geladen werden.', username);
        return;
      }

      const banMessage = this._checkBans(resolved.song, username);
      if (banMessage) {
        this._emitChatResponse(banMessage, username);
        return;
      }

      const addResult = this.queueManager.addSong({ ...resolved.song, requestedBy: username });
      if (!addResult.success) {
        this._emitChatResponse(addResult.error || 'Song konnte nicht hinzugefügt werden.', username);
        return;
      }
      this._schedulePreCache();
      this.autoDJ?.onSongRequested();
      this._emitSongAdded(addResult.song, addResult.position);

      if (!this.playbackEngine.isPlaying() && this.config.playback.autoPlay) {
        await this._playNextFromQueue();
      }

      const artist = resolved.song.artist ? ` von ${resolved.song.artist}` : '';
      this._emitChatResponse(`Hinzugefügt: ${resolved.song.title}${artist} (#${addResult.position})`, username);
    } catch (error) {
      this.api.log(`[music-bot] request failed: ${error.message}`, 'error');
      this._emitChatResponse('Song konnte nicht geladen werden.', username);
    } finally {
      this._pendingRequests.delete(lowerUser);
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

  _checkBans(song, username) {
    if (!song) return null;
    const userBan = this.banList?.isUserBanned(username);
    if (userBan?.banned) {
      return 'Dieser Nutzer darf keine Songs anfragen.';
    }

    const urlBan = this.banList?.isUrlBanned(song.url, song.youtubeId);
    if (urlBan?.banned) {
      return 'Dieser Song ist gesperrt.';
    }

    const keywordBanTitle = this.banList?.isKeywordBanned(song.title || '');
    const keywordBanChannel = this.banList?.isKeywordBanned(song.channelName || '');
    const keywordBan = keywordBanTitle?.banned ? keywordBanTitle : keywordBanChannel;
    if (keywordBan?.banned) {
      return `Dieser Song ist geblockt (Keyword: ${keywordBan.keyword}).`;
    }

    const channelBan = this.banList?.isChannelBanned(song.channelId, song.channelName);
    if (channelBan?.banned) {
      return 'Dieser Kanal ist gesperrt.';
    }

    return null;
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

  async _playNextFromQueue(retries = 0) {
    if (retries > 5) {
      this.api.log('[music-bot] Too many consecutive playback failures, stopping', 'error');
      this.playbackEngine.clearNowPlaying();
      this._emitPlaybackStopped();
      this._emitQueue();
      return;
    }
    const next = this.queueManager.shiftNext();
    if (!next) {
      const fallbackTrack = await this._playFallbackTrack();
      if (fallbackTrack) {
        this._schedulePreCache();
        return;
      }
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
      this._schedulePreCache();
    } catch (error) {
      this.api.log(`[music-bot] Playback failed: ${error.message}`, 'error');
      this._emitError(error.message);
      setImmediate(() => this._playNextFromQueue(retries + 1));
    }
  }

  _schedulePreCache() {
    try {
      const cfg = this.config.preCache || {};
      if (!cfg.enabled) return;
      const lookahead = Math.max(0, Math.min(Number(cfg.lookahead) || 2, 5));
      if (!lookahead) return;
      const upcoming = this.queueManager.getQueue().slice(0, lookahead);
      upcoming.forEach((song) => this._startPreCache(song));
    } catch (error) {
      this.api.log(`[music-bot] Failed to schedule pre-cache: ${error.message}`, 'warn');
    }
  }

  _startPreCache(song) {
    if (!song?.id || !song?.url) return;
    if (song.localPath && fs.existsSync(song.localPath)) return;
    if (this._precacheTasks.has(song.id)) return;

    const cacheState = this._precacheState.get(song.id);
    if (cacheState?.path && fs.existsSync(cacheState.path)) {
      song.localPath = cacheState.path;
      return;
    }

    const isHttpUrl = /^https?:\/\//i.test(song.url);
    if (!isHttpUrl) {
      if (fs.existsSync(song.url)) {
        song.localPath = song.url;
      }
      return;
    }

    const outputTemplate = path.join(this.cacheDir, `${song.id}-%(id)s.%(ext)s`);
    const args = [
      '--no-warnings',
      '--ignore-errors',
      '--no-playlist',
      '--format',
      'bestaudio',
      '--output',
      outputTemplate,
      '--print',
      'after_move:filepath',
      song.url
    ];

    const ytdlpPath = this.musicResolver?.config?.ytdlpPath || this.config.resolver.ytdlpPath || 'yt-dlp';
    const proc = spawn(ytdlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this._precacheTasks.set(song.id, proc);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', (error) => {
      this._precacheTasks.delete(song.id);
      this.api.log(`[music-bot] Pre-cache process failed: ${error.message}`, 'warn');
    });
    proc.on('close', () => {
      this._precacheTasks.delete(song.id);
      const cachedPath = stdout.trim().split('\n').filter(Boolean).pop();
      if (cachedPath && fs.existsSync(cachedPath)) {
        this._precacheState.set(song.id, { path: cachedPath, cachedAt: Date.now() });
        song.localPath = cachedPath;
      } else if (stderr) {
        this.api.log(`[music-bot] Pre-cache skipped for "${song.title}": ${stderr.trim()}`, 'debug');
      }
    });
  }

  async _stopPrecacheTasks() {
    const tasks = Array.from(this._precacheTasks.values());
    this._precacheTasks.clear();
    await Promise.all(tasks.map((proc) => new Promise((resolve) => {
      if (!proc || proc.exitCode !== null) {
        resolve();
        return;
      }
      proc.once('close', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGKILL');
        }
      }, 1500);
    })));
  }

  async _playFallbackTrack() {
    const cfg = this.config.fallbackPlaylist || {};
    const tracks = Array.isArray(cfg.tracks) ? cfg.tracks : [];
    if (!cfg.enabled || !tracks.length) return null;

    for (let offset = 0; offset < tracks.length; offset += 1) {
      const idx = (this._fallbackIndex + offset) % tracks.length;
      const fallback = await this._resolveFallbackTrack(tracks[idx], idx + 1);
      if (!fallback) continue;
      try {
        await this.playbackEngine.play(fallback);
        this.queueManager.markPlaying(fallback);
        this._fallbackIndex = (idx + 1) % tracks.length;
        this.api.emit('musicbot:fallback-playing', {
          title: fallback.title,
          source: fallback.source
        });
        return fallback;
      } catch (error) {
        this.api.log(`[music-bot] Fallback playback failed: ${error.message}`, 'warn');
      }
    }
    return null;
  }

  async _resolveFallbackTrack(entry, index) {
    try {
      if (!entry) return null;
      if (typeof entry === 'object' && (entry.url || entry.localPath)) {
        const rawUrl = entry.localPath || entry.url;
        const resolvedPath = this._resolveLocalPath(rawUrl);
        return {
          id: entry.id || `fallback-${index}`,
          title: entry.title || `Fallback Track ${index}`,
          artist: entry.artist || '',
          duration: entry.duration || null,
          thumbnail: entry.thumbnail || null,
          url: resolvedPath || rawUrl,
          localPath: resolvedPath || null,
          source: entry.source || 'fallback',
          requestedBy: 'fallback'
        };
      }

      const text = String(entry || '').trim();
      if (!text) return null;
      const resolvedPath = this._resolveLocalPath(text);
      if (resolvedPath) {
        return {
          id: `fallback-${createHash('sha1').update(resolvedPath).digest('hex').slice(0, 12)}`,
          title: path.basename(resolvedPath),
          artist: '',
          duration: null,
          thumbnail: null,
          url: resolvedPath,
          localPath: resolvedPath,
          source: 'fallback',
          requestedBy: 'fallback'
        };
      }

      const resolved = await this.musicResolver.resolve(text);
      if (!resolved?.success) return null;
      return {
        ...resolved.song,
        id: `fallback-${createHash('sha1').update(text).digest('hex').slice(0, 12)}`,
        requestedBy: 'fallback',
        source: resolved.song?.source || 'fallback'
      };
    } catch (error) {
      this.api.log(`[music-bot] Failed to resolve fallback track: ${error.message}`, 'warn');
      return null;
    }
  }

  _resolveLocalPath(rawPath) {
    if (!rawPath || /^https?:\/\//i.test(rawPath)) return null;
    if (path.isAbsolute(rawPath)) {
      return fs.existsSync(rawPath) ? rawPath : null;
    }
    const baseDir = this.pluginDataDir || __dirname;
    const absolute = path.resolve(baseDir, rawPath);
    if (!absolute.startsWith(path.resolve(baseDir))) return null;
    return fs.existsSync(absolute) ? absolute : null;
  }

  // ---------- Emitters ----------

  _emitStatus() {
    this.api.emit('musicbot:now-playing', this.playbackEngine.getNowPlaying());
    this._emitQueue();
    this._emitVolume(this.playbackEngine.getVolume());
  }

  _emitQueue() {
    const queue = this.queueManager.getQueue();
    this.api.emit('musicbot:queue-update', {
      queue,
      length: queue.length
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
      autoDJ: this.autoDJ?.getStatus(),
      ytdlpAvailable: this._ytdlpAvailable || false,
      mpvAvailable: this._mpvAvailable || false
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
    this.playbackSyncTimer = setInterval(async () => {
      const nowPlaying = this.playbackEngine.getNowPlaying();
      if (!nowPlaying) return;
      let position = 0;
      try {
        position = await this.playbackEngine.getPosition();
      } catch (_) {
        position = nowPlaying.startedAt ? Math.max(0, Math.floor((Date.now() - nowPlaying.startedAt) / 1000)) : 0;
      }
      this.api.emit('musicbot:playback-sync', {
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        requestedBy: nowPlaying.requestedBy,
        thumbnail: nowPlaying.thumbnail,
        duration: nowPlaying.duration,
        position,
        startedAt: nowPlaying.startedAt,
        state: this.playbackEngine.getState()
      });
    }, 5000);
  }

  _stopPlaybackSync() {
    if (this.playbackSyncTimer) {
      clearInterval(this.playbackSyncTimer);
      this.playbackSyncTimer = null;
    }
  }
}

module.exports = MusicBotPlugin;
