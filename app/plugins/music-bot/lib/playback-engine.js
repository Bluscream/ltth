const { spawn } = require('child_process');
const EventEmitter = require('events');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

class PlaybackEngine extends EventEmitter {
  constructor(config, api) {
    super();
    this.config = config;
    this.api = api;
    this.process = null;
    this.ipcPath = null;
    this.socket = null;
    this.nowPlaying = null;
    this.state = 'idle';
    this.volume = config.defaultVolume;
    this._buffer = '';
  }

  async play(track) {
    if (!track || !track.url) {
      throw new Error('Invalid track');
    }

    await this._ensureProcess();
    await this._sendCommand(['loadfile', track.url, 'replace']);
    await this.setVolume(this.volume);

    this.nowPlaying = {
      title: track.title,
      artist: track.artist || '',
      duration: track.duration || null,
      thumbnail: track.thumbnail || null,
      requestedBy: track.requestedBy || 'viewer',
      source: track.source || 'youtube',
      url: track.url,
      startedAt: Date.now()
    };
    this.state = 'playing';
    this.emit('track-start', this.nowPlaying);
  }

  async pause() {
    if (!this.process) return;
    await this._sendCommand(['set_property', 'pause', true]);
    this.state = 'paused';
    this.emit('paused');
  }

  async resume() {
    if (!this.process) return;
    await this._sendCommand(['set_property', 'pause', false]);
    this.state = 'playing';
    this.emit('resumed');
  }

  async stop() {
    if (!this.process) return;
    await this._sendCommand(['stop']);
    this.state = 'stopped';
  }

  async skip() {
    await this.stop();
    this.emit('track-end', { track: this.nowPlaying, reason: 'skip' });
  }

  async setVolume(volume) {
    this.volume = volume;
    if (!this.process) return;
    await this._sendCommand(['set_property', 'volume', volume]);
    this.emit('volume-changed', volume);
  }

  async shutdown() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    if (this.ipcPath && fs.existsSync(this.ipcPath)) {
      fs.unlinkSync(this.ipcPath);
    }
    this.nowPlaying = null;
    this.state = 'idle';
  }

  getNowPlaying() {
    return this.nowPlaying;
  }

  clearNowPlaying() {
    this.nowPlaying = null;
    this.state = 'idle';
  }

  isPlaying() {
    return this.state === 'playing';
  }

  getVolume() {
    return this.volume;
  }

  getState() {
    return this.state;
  }

  async _ensureProcess() {
    if (this.process && this.process.exitCode === null) return;

    this.ipcPath = path.join(os.tmpdir(), `music-bot-mpv-${Date.now()}.sock`);
    const args = [
      '--idle=yes',
      '--input-ipc-server',
      this.ipcPath,
      '--no-video',
      '--force-window=no',
      '--audio-display=no',
      '--audio-device',
      this.config.audioDevice
    ];

    this.process = spawn(this.config.mpvPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.on('error', (error) => {
      this.emit('error', error);
    });

    this.process.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.toLowerCase().includes('error')) {
        this.emit('error', new Error(message));
      }
    });

    await this._connectSocket();
  }

  async _connectSocket() {
    const maxAttempts = 10;
    let attempts = 0;
    await new Promise((resolve, reject) => {
      const tryConnect = () => {
        attempts += 1;
        this.socket = net.createConnection(this.ipcPath, () => {
          this.socket.setEncoding('utf8');
          this.socket.on('data', (chunk) => this._onData(chunk));
          this.socket.on('error', (error) => this.emit('error', error));
          resolve();
        });
        this.socket.on('error', (err) => {
          if (attempts >= maxAttempts) {
            reject(err);
          } else {
            setTimeout(tryConnect, 50);
          }
        });
      };
      tryConnect();
    });
  }

  async _sendCommand(command) {
    if (!this.socket) return;
    const payload = JSON.stringify({ command });
    this.socket.write(`${payload}\n`);
  }

  _onData(chunk) {
    this._buffer += chunk;
    const parts = this._buffer.split('\n');
    this._buffer = parts.pop() || '';
    for (const part of parts) {
      this._handleMessage(part);
    }
  }

  _handleMessage(raw) {
    if (!raw.trim()) return;
    try {
      const msg = JSON.parse(raw);
      if (msg.event === 'end-file') {
        this.state = 'idle';
        this.emit('track-end', { track: this.nowPlaying, reason: 'ended' });
        this.nowPlaying = null;
      } else if (msg.event === 'property-change' && msg.name === 'volume') {
        this.volume = msg.data;
        this.emit('volume-changed', this.volume);
      } else if (msg.event === 'start-file') {
        this.state = 'playing';
      }
    } catch (error) {
      this.emit('error', error);
    }
  }
}

module.exports = PlaybackEngine;
