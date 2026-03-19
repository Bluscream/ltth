const { spawn } = require('child_process');

class MusicResolver {
  constructor(config, api) {
    this.config = config;
    this.api = api;
    this.cache = new Map();
    this.cacheSizeBytes = 0;
  }

  async resolve(query) {
    if (!query) {
      throw new Error('Missing query');
    }

    const trimmed = query.trim();
    const cacheHit = this._fromCache(trimmed);
    if (cacheHit) {
      return cacheHit;
    }

    const isUrl = /^https?:\/\//i.test(trimmed);
    const target = isUrl ? trimmed : `ytsearch1:${trimmed}`;

    const args = [
      '--no-warnings',
      '--ignore-errors',
      '--skip-download',
      '--no-playlist',
      '--dump-json',
      target
    ];

    const json = await this._runYtDlp(args);
    const data = JSON.parse(json);
    const song = {
      title: data.title || trimmed,
      artist: data.artist || data.uploader || '',
      duration: data.duration || null,
      thumbnail: Array.isArray(data.thumbnails) ? data.thumbnails.at(-1)?.url : data.thumbnail,
      url: data.webpage_url || data.url || trimmed,
      source: data.extractor || (isUrl ? 'url' : 'youtube')
    };

    this._addToCache(trimmed, song);
    return song;
  }

  async _runYtDlp(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('yt-dlp timed out'));
      }, this.config.searchTimeout);

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          const message = stderr || `yt-dlp exited with code ${code}`;
          this.api.log(`[music-bot] yt-dlp failed: ${message}`, 'error');
          reject(new Error(message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  _fromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const ttlMs = this.config.cacheTTLDays * 24 * 60 * 60 * 1000;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      this.cacheSizeBytes -= entry.size;
      return null;
    }

    return entry.value;
  }

  _addToCache(key, value) {
    const serialized = JSON.stringify(value);
    const size = Buffer.byteLength(serialized, 'utf8');
    this.cache.set(key, { value, timestamp: Date.now(), size });
    this.cacheSizeBytes += size;
    this._enforceCacheLimit();
  }

  _enforceCacheLimit() {
    const maxBytes = this.config.maxCacheSizeMB * 1024 * 1024;
    if (this.cacheSizeBytes <= maxBytes) return;

    const entries = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (const [key, entry] of entries) {
      if (this.cacheSizeBytes <= maxBytes) break;
      this.cache.delete(key);
      this.cacheSizeBytes -= entry.size;
    }
  }
}

module.exports = MusicResolver;
