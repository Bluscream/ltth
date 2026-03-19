const { spawn } = require('child_process');

class MusicResolver {
  constructor(config, api) {
    const defaultModeration = {
      rejectExplicit: false,
      rejectAgeRestricted: true,
      blockedKeywords: []
    };
    this.config = {
      ...config,
      moderation: {
        ...defaultModeration,
        ...(config?.moderation || {})
      }
    };
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
      if (cacheHit.success) {
        const moderationResult = this._applyModeration(cacheHit.song);
        if (moderationResult) {
          return moderationResult;
        }
      }
      return cacheHit;
    }

    const isUrl = /^https?:\/\//i.test(trimmed);
    const target = isUrl ? trimmed : `ytsearch1:${trimmed}`;

    const args = [
      '--no-warnings',
      '--ignore-errors',
      '--skip-download',
      '--no-playlist',
      '--print',
      '%(age_limit)s',
      '--print',
      '%(channel_id)s',
      '--print',
      '%(channel)s',
      '--print',
      '%(categories)s',
      '--dump-json',
      target
    ];

    const output = await this._runYtDlp(args);
    const { data, meta } = this._parseYtDlpOutput(output);

    const ageLimit = Number.isFinite(meta.ageLimit) ? meta.ageLimit : Number(data.age_limit ?? NaN);
    const channelId = data.channel_id || meta.channelId || null;
    const channelName = data.channel || data.uploader || meta.channelName || '';
    const categories = Array.isArray(data.categories) && data.categories.length ? data.categories : meta.categories;

    const song = {
      title: data.title || trimmed,
      artist: data.artist || data.uploader || '',
      duration: data.duration || null,
      thumbnail: Array.isArray(data.thumbnails) ? data.thumbnails.at(-1)?.url : data.thumbnail,
      url: data.webpage_url || data.url || trimmed,
      localPath: null,
      source: data.extractor || (isUrl ? 'url' : 'youtube'),
      youtubeId: data.id || null,
      channelId: channelId || null,
      channelName,
      ageLimit: Number.isFinite(ageLimit) ? ageLimit : null,
      categories: categories || []
    };

    const moderationResult = this._applyModeration(song);
    if (moderationResult) {
      return moderationResult;
    }

    const response = { success: true, song };
    this._addToCache(trimmed, response);
    return response;
  }

  async _runYtDlp(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.ytdlpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timeoutMs = Number.isFinite(this.config.searchTimeout) ? this.config.searchTimeout : 15000;
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('yt-dlp timed out'));
      }, timeoutMs);

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

  _parseYtDlpOutput(raw) {
    const lines = String(raw || '')
      .trim()
      .split('\n')
      .filter(Boolean);
    if (!lines.length) {
      throw new Error('Empty yt-dlp response');
    }
    const jsonLine = lines.pop();
    let data;
    try {
      data = JSON.parse(jsonLine);
    } catch (error) {
      throw new Error('Invalid yt-dlp JSON response');
    }

    const metaLines = lines.slice(-4);
    const meta = {
      ageLimit: Number.parseInt(metaLines[0], 10),
      channelId: metaLines[1] || null,
      channelName: metaLines[2] || null,
      categories: this._parseCategories(metaLines[3])
    };

    return { data, meta };
  }

  _parseCategories(raw) {
    if (!raw) return [];
    try {
      const normalized = raw.replace(/'/g, '"');
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (typeof raw === 'string') {
        return raw
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
      }
      return [];
    }
  }

  _applyModeration(song) {
    const moderation = this.config.moderation || {};
    const ageLimit = Number.isFinite(song.ageLimit) ? song.ageLimit : null;
    if (ageLimit !== null && ageLimit >= 18 && moderation.rejectAgeRestricted) {
      return { success: false, reason: 'age_restricted', message: 'This video is age-restricted and cannot be played' };
    }

    const blockedKeywords = Array.isArray(moderation.blockedKeywords) ? moderation.blockedKeywords : [];
    const title = String(song.title || '').toLowerCase();
    const channelName = String(song.channelName || '').toLowerCase();
    for (const keyword of blockedKeywords) {
      const needle = String(keyword || '').toLowerCase();
      if (!needle) continue;
      if (title.includes(needle) || channelName.includes(needle)) {
        return {
          success: false,
          reason: 'blocked_keyword',
          keyword,
          message: `This song is blocked (keyword: "${keyword}")`
        };
      }
    }

    if (moderation.rejectExplicit) {
      const categories = Array.isArray(song.categories) ? song.categories.map((c) => String(c || '').toLowerCase()) : [];
      const explicitWords = ['explicit', 'nsfw', 'adult', 'porn', 'sexual', '18+', 'age-restricted'];
      if (categories.some((c) => explicitWords.some((w) => c.includes(w)))) {
        return {
          success: false,
          reason: 'explicit',
          message: 'This song was rejected due to explicit metadata'
        };
      }
    }

    return null;
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
