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
    this._fadeTimer = null;
    this._restartAttempts = 0;
    this._shuttingDown = false;
  }

  async play(track) {
    if (!track || !track.url) {
      throw new Error('Invalid track');
    }

    await this._ensureProcess();
    const crossfadeMs = Number(this.config.crossfadeDuration || 0);
    const hasCurrent = this.nowPlaying && this.state === 'playing';

    const newTrackPayload = {
      id: track.id,
      title: track.title,
      artist: track.artist || '',
      duration: track.duration || null,
      thumbnail: track.thumbnail || null,
      requestedBy: track.requestedBy || 'viewer',
      source: track.source || 'youtube',
      url: track.url,
      youtubeId: track.youtubeId || null,
      isGiftRequest: Boolean(track.isGiftRequest),
      startedAt: Date.now()
    };

    if (crossfadeMs > 0 && hasCurrent) {
      const currentVolume = this.volume;
      await this._fadeVolume(currentVolume, 0, crossfadeMs, true);

      await this._sendCommand(['loadfile', track.url, 'append-play']);
      await this._sendCommand(['playlist-next', 'force']);
      await this._sendCommand(['set_property', 'volume', 0]);

      this.nowPlaying = newTrackPayload;
      this.state = 'playing';
      this.emit('track-start', this.nowPlaying);

      await this._fadeVolume(0, currentVolume, crossfadeMs, true);
    } else {
      await this._sendCommand(['loadfile', track.url, 'replace']);
      await this.setVolume(this.volume);

      this.nowPlaying = newTrackPayload;
      this.state = 'playing';
      this.emit('track-start', this.nowPlaying);
    }
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
    this._shuttingDown = true;
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
    this._restartAttempts = 0;
    this._shuttingDown = false;
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
      this.config.audioDevice || 'auto'
    ];

    try {
      this.process = spawn(this.config.mpvPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnError) {
      this.emit('error', new Error(
        `mpv konnte nicht gestartet werden ("${this.config.mpvPath}"): ${spawnError.message}. ` +
        'Bitte installiere mpv (https://mpv.io) oder setze den korrekten Pfad in den Music Bot Einstellungen.'
      ));
      throw spawnError;
    }

    this._shuttingDown = false;
    this._restartAttempts = 0;

    this.process.on('error', (error) => {
      if (error.code === 'ENOENT') {
        this.emit('error', new Error(
          `mpv nicht gefunden ("${this.config.mpvPath}"). ` +
          'Installiere mpv: https://mpv.io/installation/ — oder setze den Pfad in Music Bot → Einstellungen → Playback.'
        ));
        return;
      }
      this.emit('error', error);
    });

    this.process.on('close', (code) => {
      this.socket?.destroy();
      this.socket = null;
      this.process = null;
      if (this._shuttingDown) {
        return;
      }
      this.state = 'idle';
      this.emit('crashed', { code });
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

  async _fadeVolume(from, to, durationMs, emitVolumeEvent = true) {
    if (this._fadeTimer) {
      clearInterval(this._fadeTimer);
      this._fadeTimer = null;
    }
    const duration = Math.max(durationMs, 0);
    if (duration === 0 || from === to) {
      this.volume = to;
      await this._sendCommand(['set_property', 'volume', to]);
      if (emitVolumeEvent) {
        this.emit('volume-changed', to);
      }
      return;
    }

    const stepInterval = 50;
    const steps = Math.ceil(duration / stepInterval);
    const delta = (to - from) / steps;
    let currentStep = 0;
    let currentVolume = from;

    await this._sendCommand(['set_property', 'volume', from]);

    await new Promise((resolve) => {
      this._fadeTimer = setInterval(async () => {
        try {
          currentStep += 1;
          currentVolume = currentVolume + delta;
          if (currentStep >= steps) {
            currentVolume = to;
          }
          this.volume = currentVolume;
          await this._sendCommand(['set_property', 'volume', currentVolume]);
          if (emitVolumeEvent) {
            this.emit('volume-changed', currentVolume);
          }
          if (currentStep >= steps) {
            clearInterval(this._fadeTimer);
            this._fadeTimer = null;
            resolve();
          }
        } catch (error) {
          clearInterval(this._fadeTimer);
          this._fadeTimer = null;
          this.emit('error', error);
          resolve();
        }
      }, stepInterval);
    });
  }

  async getAvailableDevices() {
    return new Promise((resolve) => {
      try {
        const proc = spawn(this.config.mpvPath, ['--audio-device=help'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        proc.on('close', () => {
          const lines = stdout.split('\n');
          const devices = [];
          lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('Available') || trimmed.startsWith('Auto')) {
              return;
            }
            const parts = trimmed.split(':').map((p) => p.trim());
            if (parts.length >= 2) {
              devices.push({ id: parts[0], name: parts.slice(1).join(':') });
            }
          });
          resolve(devices);
        });
        proc.on('error', () => resolve([]));
      } catch (error) {
        this.api.log?.(`[music-bot] Failed to list audio devices: ${error.message}`, 'error');
        resolve([]);
      }
    });
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
