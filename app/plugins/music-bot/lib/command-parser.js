class CommandParser {
  constructor(config, queueManager, playbackEngine, musicResolver, api, banList, chatCallback) {
    this.config = config;
    this.queueManager = queueManager;
    this.playbackEngine = playbackEngine;
    this.musicResolver = musicResolver;
    this.api = api;
    this.banList = banList;
    this.chatCallback = chatCallback;
    this.db = api.getDatabase();
  }

  async parse(chatData, onCommand) {
    const rawMessage = chatData?.message || chatData?.comment || '';
    const message = typeof rawMessage === 'string' ? rawMessage.trim() : '';
    const username = chatData?.username || chatData?.nickname || 'viewer';
    if (!message.startsWith(this.config.commandPrefix)) {
      return;
    }

    const [commandKey, ...args] = message.slice(this.config.commandPrefix.length).trim().split(/\s+/);
    if (!commandKey) return;

    const commandType = this._resolveCommand(commandKey.toLowerCase());
    if (!commandType) return;

    const required = this._getPermissionForCommand(commandType);
    const allowed = await this._hasPermission(username, required);
    if (!allowed) {
      this._respond(`Keine Berechtigung für ${commandType}.`, username);
      return;
    }

    // Feature 3: optional superfan-only song requests
    if (commandType === 'request' && this.config.permissions?.requireSuperfanForRequest) {
      const isStreamerOrMod = await this._isBypassRole(username);
      if (!isStreamerOrMod && !this._isSuperFan(chatData)) {
        this._respond('Nur Superfans dürfen Songs anfragen! 🌟', username);
        return;
      }
    }

    const commandPayload = this._buildCommandPayload(commandType, args, required);
    if (commandPayload && onCommand) {
      await onCommand(commandPayload);
    }
  }

  _resolveCommand(key) {
    const entries = Object.entries(this.config.commands);
    for (const [type, value] of entries) {
      if (value === key) return type;
    }

    for (const [type, value] of entries) {
      const aliases = this.config.commandAliases?.[type] || [];
      if (aliases.includes(key)) return type;
    }
    return null;
  }

  _buildCommandPayload(type, args, requiredPermission) {
    switch (type) {
      case 'request':
        return { type, query: this._normalizeQuery(args) };
      case 'volume': {
        const value = Number(args[0]);
        if (Number.isFinite(value)) {
          return { type, value };
        }
        return { type };
      }
      case 'skip':
        return { type, force: requiredPermission !== 'viewer' };
      case 'queue':
      case 'nowPlaying':
      case 'pause':
      case 'resume':
      case 'clear':
        return { type };
      default:
        return null;
    }
  }

  /**
   * Normalizes a song query from chat args.
   * Detects separator patterns (" - ", " von ", " by ", " from ") to split
   * the input into artist and title, then reorders as "{artist} {title}" so
   * YouTube search returns more reliable results.
   * Falls back to the raw joined args when no separator is found.
   * @param {string[]} args - Tokenised words following the command keyword
   * @returns {string} Normalized query string
   */
  _normalizeQuery(args) {
    const raw = args.join(' ').trim();
    if (!raw) return raw;

    const separatorPattern = /\s+(?:-|von|by|from)\s+/i;
    const match = raw.match(separatorPattern);
    if (!match) return raw;

    const sepIndex = raw.indexOf(match[0]);
    const before = raw.slice(0, sepIndex).trim();
    const after = raw.slice(sepIndex + match[0].length).trim();
    if (!before || !after) return raw;

    // Reorder as "artist title" – YouTube search is more reliable that way
    return `${after} ${before}`;
  }

  async _hasPermission(username, requiredLevel) {
    if (requiredLevel === 'viewer') return true;
    if (requiredLevel === 'streamer') {
      const targetName = await this._getStreamerUsername();
      return targetName ? targetName.toLowerCase() === username.toLowerCase() : false;
    }
    // follower/subscriber/mod: fallback to viewer until richer role data is available
    return true;
  }

  /**
   * Returns true for users who bypass the superfan restriction.
   * Currently only the streamer bypasses this check. Moderator detection
   * from TikTok chat data alone is not reliably available (TikTok does not
   * always send moderator role flags via chat events).
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async _isBypassRole(username) {
    const streamer = await this._getStreamerUsername();
    if (streamer && streamer.toLowerCase() === username.toLowerCase()) return true;
    return false;
  }

  /**
   * Checks TikTok chat event data for SuperFan status.
   * Supports isSuperFan, superFan boolean flags and badges arrays.
   * @param {object} chatData - TikTok chat event object
   * @returns {boolean}
   */
  _isSuperFan(chatData) {
    if (!chatData) return false;
    if (chatData.isSuperFan === true || chatData.superFan === true) return true;
    if (Array.isArray(chatData.badges)) {
      return chatData.badges.some(
        (b) =>
          b.type === 'superfan' ||
          (typeof b.name === 'string' && b.name.toLowerCase().includes('superfan'))
      );
    }
    return false;
  }

  _getPermissionForCommand(type) {
    return this.config.permissions?.[type] || 'viewer';
  }

  async _getStreamerUsername() {
    try {
      const row = this.db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get('tiktok_username');
      return row?.value || null;
    } catch (error) {
      this.api.log(`[music-bot] Failed to read streamer username: ${error.message}`, 'error');
      return null;
    }
  }

  _respond(message, username) {
    if (this.chatCallback) {
      this.chatCallback({ message, username });
    }
  }
}

module.exports = CommandParser;
