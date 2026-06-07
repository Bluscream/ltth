const osc = require('osc');

class OscSendService {
  constructor({
    getConfig,
    getTransport,
    logger = console,
    emit = () => {},
    logToFile = () => {},
    stats = null
  }) {
    this.getConfig = getConfig;
    this.getTransport = getTransport;
    this.logger = logger;
    this.emit = emit;
    this.logToFile = logToFile;
    this.stats = stats;
    this.cache = new Map();
    this.rateWindow = [];
    this.batchQueue = [];
    this.batchTimer = null;
  }

  sendMessage(address, args = []) {
    const argArray = Array.isArray(args) ? args : [args];
    const config = this.getConfig() || {};
    const transport = this.getTransport();

    const addressError = validateAddress(address);
    if (addressError) {
      return this._failure(address, argArray, addressError);
    }

    if (!transport?.isRunning?.()) {
      return this._failure(address, argArray, 'OSC bridge is not running');
    }

    if (config.rateLimiting?.enabled && !this._consumeRateLimit(config.rateLimiting.maxPerSecond || 100)) {
      return this._failure(address, argArray, 'OSC rate limit exceeded');
    }

    const value = argArray[0];
    if (config.parameterCaching?.enabled && !this._shouldSend(address, value, config.parameterCaching.ttl || 5000)) {
      return {
        success: true,
        skipped: true,
        reason: 'cached',
        address,
        args: argArray
      };
    }

    const message = {
      address,
      args: argArray.map(convertToOSCArg)
    };

    try {
      if (config.messageBatching?.enabled) {
        this._enqueueBatch(transport, message, config.messageBatching.batchWindow || 10);
        if (this.stats) this.stats.batchedMessages++;
      } else {
        transport.send(message);
      }

      if (config.parameterCaching?.enabled) {
        this._updateCache(address, value);
      }

      const timestamp = new Date();
      if (this.stats) {
        this.stats.messagesSent++;
        this.stats.lastMessageSent = { address, args: argArray, timestamp };
      }

      this.logToFile('SEND', `SEND -> ${address} ${JSON.stringify(argArray)}`);
      this.emit('osc:sent', { address, args: argArray, timestamp });

      return {
        success: true,
        address,
        args: argArray
      };
    } catch (error) {
      return this._failure(address, argArray, error?.message || String(error));
    }
  }

  clear() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.batchQueue = [];
    this.cache.clear();
    this.rateWindow = [];
  }

  _failure(address, args, error) {
    if (this.stats) this.stats.errors++;
    this.logger.warn?.(`OSC send failed: ${error}`);
    return {
      success: false,
      error,
      address,
      args
    };
  }

  _enqueueBatch(transport, message, batchWindow) {
    this.batchQueue.push(message);
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      const packets = this.batchQueue;
      this.batchQueue = [];
      this.batchTimer = null;

      if (packets.length === 1) {
        transport.send(packets[0]);
        return;
      }

      transport.send({
        timeTag: osc.timeTag(0),
        packets
      });
    }, batchWindow);
  }

  _consumeRateLimit(maxPerSecond) {
    const now = Date.now();
    const cutoff = now - 1000;
    this.rateWindow = this.rateWindow.filter(timestamp => timestamp > cutoff);
    if (this.rateWindow.length >= maxPerSecond) {
      return false;
    }
    this.rateWindow.push(now);
    return true;
  }

  _shouldSend(address, value, ttl) {
    const cached = this.cache.get(address);
    if (!cached) return true;
    if (Date.now() - cached.timestamp > ttl) return true;
    return cached.value !== value;
  }

  _updateCache(address, value) {
    this.cache.set(address, {
      value,
      timestamp: Date.now()
    });
  }
}

function validateAddress(address) {
  if (typeof address !== 'string' || address.length === 0) {
    return 'OSC address is required';
  }
  if (!address.startsWith('/')) {
    return 'OSC address must start with /';
  }
  if (address.includes('..') || address.includes('\\')) {
    return 'OSC address contains unsafe path characters';
  }
  return null;
}

function convertToOSCArg(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'i', value } : { type: 'f', value };
  }
  if (typeof value === 'string') {
    return { type: 's', value };
  }
  if (typeof value === 'boolean') {
    return { type: value ? 'T' : 'F' };
  }
  return { type: 's', value: String(value) };
}

module.exports = OscSendService;
