const { randomUUID } = require('crypto');

class QueueManager {
  constructor(config, api) {
    this.config = config || {};
    this.queueConfig = config.queue || {};
    this.api = api;
    this.db = api.getDatabase();
    this.queue = [];
    this.history = [];
    this.current = null;
    this.userLastRequest = new Map();
    this.voteSkipVoters = new Set();
    this.skipImmuneUsers = new Set();
    this._ensureHistoryTable();
  }

  getQueue() {
    return this.queue;
  }

  getHistory() {
    return this.history.slice(-50);
  }

  getCurrent() {
    return this.current;
  }

  addSkipImmunity(username) {
    if (!username) return;
    this.skipImmuneUsers.add(username.toLowerCase());
  }

  removeSkipImmunity(username) {
    if (!username) return;
    this.skipImmuneUsers.delete(username.toLowerCase());
  }

  clearSkipImmunity() {
    this.skipImmuneUsers.clear();
  }

  isSkipImmune(username) {
    if (!username) return false;
    return this.skipImmuneUsers.has(username.toLowerCase());
  }

  addVoteSkip(username) {
    const required = this._computeRequiredVotes();
    if (!this.current) {
      return { skipped: false, votes: this.voteSkipVoters.size, required };
    }
    if (this.isSkipImmune(this.current?.requestedBy)) {
      return {
        skipped: false,
        votes: this.voteSkipVoters.size,
        required,
        immuneInfo: { requestedBy: this.current?.requestedBy }
      };
    }

    const voterKey = (username || '').toLowerCase();
    if (!voterKey) {
      return { skipped: false, votes: this.voteSkipVoters.size, required };
    }

    if (this.voteSkipVoters.has(voterKey)) {
      return {
        skipped: false,
        votes: this.voteSkipVoters.size,
        required,
        duplicateVote: true
      };
    }

    this.voteSkipVoters.add(voterKey);
    const skipped = this.voteSkipVoters.size >= required;
    return { skipped, votes: this.voteSkipVoters.size, required };
  }

  resetVoteSkips() {
    this.voteSkipVoters.clear();
  }

  getVoteVoters() {
    return Array.from(this.voteSkipVoters);
  }

  addSong(song) {
    const validation = this._validateSong(song);
    if (!validation.success) {
      return validation;
    }

    const youtubeId = this._extractYouTubeId(song);

    const songEntry = {
      id: song.id || randomUUID(),
      title: song.title,
      artist: song.artist || '',
      duration: song.duration || null,
      thumbnail: song.thumbnail || null,
      url: song.url,
      youtubeId: youtubeId || null,
      source: song.source || 'youtube',
      requestedBy: song.requestedBy || 'viewer',
      isGiftRequest: Boolean(song.isGiftRequest),
      addedAt: Date.now()
    };

    this.queue.push(songEntry);
    if (songEntry.requestedBy) {
      this.userLastRequest.set(songEntry.requestedBy, Date.now());
    }

    return {
      success: true,
      song: songEntry,
      position: this.queue.length
    };
  }

  shiftNext() {
    this.current = this.queue.shift() || null;
    return this.current;
  }

  clear() {
    this.queue = [];
    this.current = null;
    this.userLastRequest.clear();
    this.resetVoteSkips();
    this.clearSkipImmunity();
  }

  markPlaying(track) {
    this.current = track;
  }

  addToHistory(track, skipped = false) {
    if (track) {
      const historyEntry = {
        ...track,
        finishedAt: Date.now(),
        skipped
      };
      this.history.push(historyEntry);
      if (this.history.length > 50) {
        this.history = this.history.slice(-50);
      }
      this._persistHistory(historyEntry);
    }
  }

  normalizeSongTitle(title = '') {
    return title
      .toLowerCase()
      .replace(/\(official\s*(music\s*)?video\)/gi, '')
      .replace(/\(lyrics?\)/gi, '')
      .replace(/\(audio\)/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?remix.*?\)/gi, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  isFuzzyMatch(titleA, titleB, threshold = 0.85) {
    const normA = this.normalizeSongTitle(titleA);
    const normB = this.normalizeSongTitle(titleB);
    if (!normA || !normB) return false;
    if (normA.includes(normB) || normB.includes(normA)) {
      return true;
    }
    const bigramsA = this._bigrams(normA);
    const bigramsB = this._bigrams(normB);
    if (!bigramsA.length || !bigramsB.length) return false;
    const matches = this._bigramMatches(bigramsA, bigramsB);
    const dice = (2 * matches) / (bigramsA.length + bigramsB.length);
    return dice >= threshold;
  }

  _bigrams(text) {
    const grams = [];
    for (let i = 0; i < text.length - 1; i += 1) {
      grams.push(text.slice(i, i + 2));
    }
    return grams;
  }

  _bigramMatches(a, b) {
    const map = new Map();
    a.forEach((gram) => map.set(gram, (map.get(gram) || 0) + 1));
    let matches = 0;
    b.forEach((gram) => {
      if (map.has(gram) && map.get(gram) > 0) {
        matches += 1;
        map.set(gram, map.get(gram) - 1);
      }
    });
    return matches;
  }

  _computeRequiredVotes() {
    const minVotes = Math.max(Number(this.config.voteSkip?.minVotes) || 0, 1);
    const thresholdPercent = Math.max(Number(this.config.voteSkip?.thresholdPercent) || 0, 0);
    const thresholdCount = Math.ceil((thresholdPercent / 100) * minVotes);
    return Math.max(minVotes, thresholdCount);
  }

  _validateSong(song) {
    if (!song || !song.title || !song.url) {
      return { success: false, error: 'Invalid song data' };
    }

    if (this.queue.length >= this.queueConfig.maxLength) {
      return { success: false, error: 'Queue is full' };
    }

    if (song.duration && song.duration > this.queueConfig.maxSongDurationSeconds) {
      return { success: false, error: 'Song is too long' };
    }

    const duplicatesDisabled =
      this.queueConfig.duplicateDetection === 'off' || this.queueConfig.allowDuplicates;
    if (!duplicatesDisabled) {
      const duplicate = this._findDuplicate(song);
      if (duplicate) {
        return {
          success: false,
          error: `Song bereits in der Queue (#${duplicate.position} – ${duplicate.entry.title})`,
          duplicate
        };
      }
    }

    if (song.requestedBy) {
      const count = this.queue.filter((s) => s.requestedBy === song.requestedBy).length;
      if (count >= this.queueConfig.maxPerUser) {
        return { success: false, error: 'User queue limit reached' };
      }

      const lastRequest = this.userLastRequest.get(song.requestedBy);
      const cooldownSeconds = Number(this.queueConfig.cooldownPerUserSeconds) || 0;
      if (lastRequest) {
        const diffSeconds = (Date.now() - lastRequest) / 1000;
        if (
          diffSeconds < cooldownSeconds &&
          !(song.isGiftRequest && this.queueConfig.cooldownBypassForGifts)
        ) {
          const remaining = Math.ceil(cooldownSeconds - diffSeconds);
          return {
            success: false,
            error: `@${song.requestedBy}, du kannst in ${remaining} Sekunden wieder requesten.`
          };
        }
      }
    }

    return { success: true };
  }

  _findDuplicate(song) {
    const mode = this.queueConfig.duplicateDetection || 'strict';
    if (mode === 'off') return null;

    const youtubeId = this._extractYouTubeId(song);

    for (let i = 0; i < this.queue.length; i += 1) {
      const entry = this.queue[i];
      if (mode === 'strict') {
        if (
          (youtubeId && entry.youtubeId && youtubeId === entry.youtubeId) ||
          entry.url === song.url
        ) {
          return { position: i + 1, entry, matchType: youtubeId ? 'youtubeId' : 'url' };
        }
      }

      if (
        mode === 'fuzzy' &&
        (this.isFuzzyMatch(entry.title, song.title) ||
          (youtubeId && entry.youtubeId && youtubeId === entry.youtubeId))
      ) {
        return { position: i + 1, entry, matchType: 'fuzzy' };
      }
    }
    return null;
  }

  _extractYouTubeId(song) {
    if (song.youtubeId) return song.youtubeId;
    const url = song.url || '';
    const match = url.match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([A-Za-z0-9_-]{6,})/
    );
    return match ? match[1] : null;
  }

  _persistHistory(track) {
    try {
      const stmt = this.db.prepare(
        `INSERT OR REPLACE INTO plugin_music_bot_history
          (id, youtubeId, title, artist, url, duration, requestedBy, source, thumbnail, finishedAt, skipped)
          VALUES (@id, @youtubeId, @title, @artist, @url, @duration, @requestedBy, @source, @thumbnail, @finishedAt, @skipped)`
      );
      stmt.run({
        id: track.id || randomUUID(),
        youtubeId: track.youtubeId || this._extractYouTubeId(track),
        title: track.title || '',
        artist: track.artist || '',
        url: track.url || '',
        duration: track.duration || null,
        requestedBy: track.requestedBy || 'viewer',
        source: track.source || 'youtube',
        thumbnail: track.thumbnail || null,
        finishedAt: track.finishedAt || Date.now(),
        skipped: track.skipped ? 1 : 0
      });
    } catch (error) {
      this.api.log?.(`[music-bot] Failed to persist history: ${error.message}`, 'error');
    }
  }

  _ensureHistoryTable() {
    try {
      this.db
        .prepare(
          `CREATE TABLE IF NOT EXISTS plugin_music_bot_history (
            id TEXT PRIMARY KEY,
            youtubeId TEXT,
            title TEXT,
            artist TEXT,
            url TEXT,
            duration INTEGER,
            requestedBy TEXT,
            source TEXT,
            thumbnail TEXT,
            finishedAt INTEGER,
            skipped INTEGER DEFAULT 0
          )`
        )
        .run();
    } catch (error) {
      this.api.log?.(`[music-bot] Failed to ensure history table: ${error.message}`, 'error');
    }
  }
}

module.exports = QueueManager;
