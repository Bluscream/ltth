(function () {
  const PROFILES = {
    ultra: {
      particleBudget: 240,
      actorCap: 360,
      trailAlpha: 0.34,
      resolutionScale: 1,
      bloomStrength: 0.92,
      secondaryBurstFactor: 0.42,
      debrisFactor: 1,
      ribbonCount: 3,
      shockwaveScale: 1.15,
      flashAlpha: 0.72,
      parallaxStrength: 1
    },
    high: {
      particleBudget: 180,
      actorCap: 280,
      trailAlpha: 0.28,
      resolutionScale: 0.92,
      bloomStrength: 0.82,
      secondaryBurstFactor: 0.32,
      debrisFactor: 0.75,
      ribbonCount: 2,
      shockwaveScale: 1,
      flashAlpha: 0.58,
      parallaxStrength: 0.92
    },
    medium: {
      particleBudget: 128,
      actorCap: 210,
      trailAlpha: 0.22,
      resolutionScale: 0.84,
      bloomStrength: 0.66,
      secondaryBurstFactor: 0.18,
      debrisFactor: 0.45,
      ribbonCount: 1,
      shockwaveScale: 0.88,
      flashAlpha: 0.46,
      parallaxStrength: 0.84
    },
    low: {
      particleBudget: 82,
      actorCap: 150,
      trailAlpha: 0.16,
      resolutionScale: 0.72,
      bloomStrength: 0.54,
      secondaryBurstFactor: 0.1,
      debrisFactor: 0.22,
      ribbonCount: 1,
      shockwaveScale: 0.74,
      flashAlpha: 0.34,
      parallaxStrength: 0.72
    }
  };

  class PerformanceScaler {
    constructor(rootEl) {
      this.rootEl = rootEl;
      this.profileName = 'ultra';
      this.fpsSamples = [];
      this.currentFps = 60;
    }

    setProfile(name) {
      this.profileName = PROFILES[name] ? name : 'ultra';
      const profile = this.getProfile();
      this.rootEl.style.setProperty('--bloom-strength', String(profile.bloomStrength));
      this.rootEl.style.setProperty('--parallax-strength', String(profile.parallaxStrength));
      return profile;
    }

    getProfile() {
      return PROFILES[this.profileName] || PROFILES.ultra;
    }

    recordFrame(frameMs) {
      const fps = frameMs > 0 ? 1000 / frameMs : 60;
      this.currentFps = fps;
      this.fpsSamples.push(fps);
      if (this.fpsSamples.length > 30) {
        this.fpsSamples.shift();
      }
      return this.getRecommendedProfile();
    }

    getRecommendedProfile() {
      const avg = this.getAverageFps();
      if (avg >= 58) return 'ultra';
      if (avg >= 49) return 'high';
      if (avg >= 38) return 'medium';
      return 'low';
    }

    getAverageFps() {
      if (!this.fpsSamples.length) {
        return this.currentFps;
      }
      return this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    }
  }

  window.FireworksDevPerformanceScaler = PerformanceScaler;
})();
