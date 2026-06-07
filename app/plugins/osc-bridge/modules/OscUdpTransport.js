const EventEmitter = require('events');
const osc = require('osc');

class OscUdpTransport extends EventEmitter {
  constructor({ logger = console } = {}) {
    super();
    this.logger = logger;
    this.port = null;
    this.state = 'stopped';
    this.lastError = null;
    this.boundConfig = null;
    this._startPromise = null;
  }

  isRunning() {
    return this.state === 'running' && Boolean(this.port);
  }

  async start(config) {
    if (this.state === 'running') {
      return { success: false, error: 'Already running' };
    }

    if (this.state === 'starting' && this._startPromise) {
      return this._startPromise;
    }

    this.state = 'starting';
    this.lastError = null;
    this.boundConfig = {
      receivePort: config.receivePort,
      sendHost: config.sendHost,
      sendPort: config.sendPort
    };

    this._startPromise = new Promise((resolve) => {
      let settled = false;
      const udpPort = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: config.receivePort,
        remoteAddress: config.sendHost,
        remotePort: config.sendPort,
        metadata: true
      });

      const settle = (result) => {
        if (settled) return;
        settled = true;
        this._startPromise = null;
        resolve(result);
      };

      udpPort.once('ready', () => {
        this.port = udpPort;
        this.state = 'running';
        this.emit('ready');
        settle({ success: true });
      });

      udpPort.on('message', (oscMessage, timeTag, info) => {
        this.emit('message', oscMessage, timeTag, info);
      });

      udpPort.once('error', (error) => {
        this.lastError = {
          message: error?.message || String(error),
          code: error?.code || null,
          timestamp: Date.now()
        };
        this.state = 'error';
        this.port = null;
        if (this.listenerCount('error') > 0) {
          this.emit('error', error);
        }
        this.emit('transport_error', error);
        tryClose(udpPort);
        settle({
          success: false,
          error: this.lastError.message,
          code: this.lastError.code
        });
      });

      udpPort.on('close', () => {
        if (this.port === udpPort) {
          this.port = null;
        }
        if (this.state !== 'error') {
          this.state = 'stopped';
        }
        this.emit('close');
      });

      this.port = udpPort;

      try {
        udpPort.open();
      } catch (error) {
        this.lastError = {
          message: error?.message || String(error),
          code: error?.code || null,
          timestamp: Date.now()
        };
        this.state = 'error';
        this.port = null;
        tryClose(udpPort);
        settle({
          success: false,
          error: this.lastError.message,
          code: this.lastError.code
        });
      }
    });

    return this._startPromise;
  }

  async stop() {
    if (!this.port) {
      this.state = 'stopped';
      this._startPromise = null;
      return { success: true, alreadyStopped: true };
    }

    const port = this.port;
    this.state = 'stopping';
    this.port = null;
    this._startPromise = null;

    await new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        resolve();
      };

      port.once?.('close', done);
      try {
        if (typeof port.close === 'function') {
          port.close();
        } else {
          done();
        }
      } catch (error) {
        this.logger.warn?.(`OSC UDP close failed: ${error.message}`);
        done();
      }

      setTimeout(done, 100);
    });

    this.state = 'stopped';
    return { success: true };
  }

  send(message) {
    if (!this.isRunning()) {
      throw new Error('OSC UDP transport is not running');
    }
    this.port.send(message);
  }

  getStatus() {
    return {
      state: this.state,
      isRunning: this.isRunning(),
      boundConfig: this.boundConfig,
      lastError: this.lastError
    };
  }
}

function tryClose(port) {
  try {
    port?.close?.();
  } catch (_) {
    // Ignore close errors during startup failure cleanup.
  }
}

module.exports = OscUdpTransport;
