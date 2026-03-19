const { randomUUID } = require('crypto');

class QueueManager {
  constructor(config, api) {
    this.config = config;
    this.api = api;
    this.queue = [];
    this.history = [];
    this.current = null;
    this.userLastRequest = new Map();
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

  addSong(song) {
    const validation = this._validateSong(song);
    if (!validation.success) {
      return validation;
    }

    const songEntry = {
      id: song.id || randomUUID(),
      title: song.title,
      artist: song.artist || '',
      duration: song.duration || null,
      thumbnail: song.thumbnail || null,
      url: song.url,
      source: song.source || 'youtube',
      requestedBy: song.requestedBy || 'viewer',
      addedAt: Date.now()
    };

    this.queue.push(songEntry);
    this.userLastRequest.set(songEntry.requestedBy, Date.now());

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
  }

  markPlaying(track) {
    this.current = track;
  }

  addToHistory(track) {
    if (track) {
      this.history.push({
        ...track,
        finishedAt: Date.now()
      });
      if (this.history.length > 50) {
        this.history = this.history.slice(-50);
      }
    }
  }

  _validateSong(song) {
    if (!song || !song.title || !song.url) {
      return { success: false, error: 'Invalid song data' };
    }

    if (this.queue.length >= this.config.maxLength) {
      return { success: false, error: 'Queue is full' };
    }

    if (song.duration && song.duration > this.config.maxSongDurationSeconds) {
      return { success: false, error: 'Song is too long' };
    }

    if (!this.config.allowDuplicates && this._isDuplicate(song)) {
      return { success: false, error: 'Song already in queue' };
    }

    if (song.requestedBy) {
      const count = this.queue.filter((s) => s.requestedBy === song.requestedBy).length;
      if (count >= this.config.maxPerUser) {
        return { success: false, error: 'User queue limit reached' };
      }

      const lastRequest = this.userLastRequest.get(song.requestedBy);
      if (lastRequest) {
        const diffSeconds = (Date.now() - lastRequest) / 1000;
        if (diffSeconds < this.config.cooldownPerUserSeconds) {
          return { success: false, error: 'Please wait before requesting again' };
        }
      }
    }

    return { success: true };
  }

  _isDuplicate(song) {
    return this.queue.some(
      (entry) =>
        entry.url === song.url ||
        (entry.title?.toLowerCase() === song.title?.toLowerCase() &&
          entry.artist?.toLowerCase() === (song.artist || '').toLowerCase())
    );
  }
}

module.exports = QueueManager;
