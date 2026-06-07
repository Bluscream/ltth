(function () {
  class AudioDirector {
    constructor() {
      this.lastPlayAt = 0;
      this.cooldownMs = 140;
      this.audioEnabled = true;
      this.audioVolume = 0.45;
      this.maxSimultaneousSounds = 2;
      this.benchmarkMode = false;
      this.benchmarkMuteAudio = true;
      this.activePlayers = new Set();
      this.duckingFloor = 0.28;
    }

    configure(config) {
      this.audioEnabled = config.audioEnabled !== false;
      this.audioVolume = Math.max(0, Math.min(1, Number(config.audioVolume) || 0.45));
      this.cooldownMs = Math.max(40, Number(config.audioCooldownMs) || 140);
      this.maxSimultaneousSounds = Math.max(1, Number(config.maxSimultaneousSounds) || 2);
      this.benchmarkMode = config.benchmarkMode === true;
      this.benchmarkMuteAudio = config.benchmarkMuteAudio !== false;
    }

    play(payload, theme) {
      if (!this.audioEnabled || (this.benchmarkMode && this.benchmarkMuteAudio)) {
        return;
      }

      const now = Date.now();
      if (now - this.lastPlayAt < this.cooldownMs) {
        return;
      }
      if (this.activePlayers.size >= this.maxSimultaneousSounds) {
        return;
      }
      this.lastPlayAt = now;

      const audio = new Audio(this.getClip(payload, theme));
      const baseVolume = Math.max(0, Math.min(1, Number(payload.audioVolume) || this.audioVolume));
      const duckedVolume = baseVolume * Math.max(this.duckingFloor, 1 - this.activePlayers.size * 0.32);
      audio.volume = Math.max(0, Math.min(1, duckedVolume));
      audio.preload = 'auto';

      const cleanup = () => {
        this.activePlayers.delete(audio);
        audio.removeEventListener('ended', cleanup);
        audio.removeEventListener('error', cleanup);
      };

      this.activePlayers.add(audio);
      audio.addEventListener('ended', cleanup, { once: true });
      audio.addEventListener('error', cleanup, { once: true });
      audio.play().catch(() => {
        cleanup();
      });
    }

    getClip(payload, theme) {
      if (payload.ultimateTier || payload.screenFxPreset === 'finale') {
        return '/plugins/fireworks-dev/audio/explosion_huge.mp3';
      }
      if (theme.label === 'Neon Reactor') {
        return '/plugins/fireworks-dev/audio/woosh_abheben_mit-pfeifen_normal-bang.mp3';
      }
      if (theme.label === 'Celestial Titan') {
        return '/plugins/fireworks-dev/audio/explosion_medium.mp3';
      }
      return '/plugins/fireworks-dev/audio/woosh_abheben_crackling_bang.mp3';
    }
  }

  window.FireworksDevAudioDirector = AudioDirector;
})();
