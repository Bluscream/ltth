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

    const required = this.config.permissions[commandType] || 'viewer';
    const allowed = await this._hasPermission(username, required);
    if (!allowed) {
      this._respond(`Keine Berechtigung für ${commandType}.`, username);
      return;
    }

    const commandPayload = this._buildCommandPayload(commandType, args);
    if (commandPayload && onCommand) {
      await onCommand(commandPayload);
    }
  }

  _resolveCommand(key) {
    const entries = Object.entries(this.config.commands);
    for (const [type, value] of entries) {
      if (value === key) return type;
      const aliases = this.config.commandAliases[type] || [];
      if (aliases.includes(key)) {
        return type;
      }
    }
    return null;
  }

  _buildCommandPayload(type, args) {
    switch (type) {
      case 'request':
        return { type, query: args.join(' ') };
      case 'volume': {
        const value = Number(args[0]);
        if (Number.isFinite(value)) {
          return { type, value };
        }
        return { type };
      }
      case 'skip':
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

  async _hasPermission(username, requiredLevel) {
    if (requiredLevel === 'viewer') return true;
    if (requiredLevel === 'streamer') {
      const targetName = await this._getStreamerUsername();
      return targetName ? targetName.toLowerCase() === username.toLowerCase() : false;
    }
    // follower/subscriber/mod: fallback to viewer until richer role data is available
    return true;
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
