class EngineCircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownMs = options.cooldownMs || 30000;
    this.now = options.now || Date.now;
    this.states = new Map();
  }

  _getOrCreate(engine) {
    if (!this.states.has(engine)) {
      this.states.set(engine, {
        state: 'closed',
        failures: 0,
        openedAt: null,
        lastError: null,
        lastFailureAt: null,
        lastSuccessAt: null
      });
    }

    return this.states.get(engine);
  }

  canCall(engine) {
    const state = this._getOrCreate(engine);

    if (state.state !== 'open') {
      return true;
    }

    if (this.now() - state.openedAt >= this.cooldownMs) {
      state.state = 'half_open';
      return true;
    }

    return false;
  }

  recordSuccess(engine) {
    const state = this._getOrCreate(engine);
    state.state = 'closed';
    state.failures = 0;
    state.openedAt = null;
    state.lastSuccessAt = this.now();
  }

  recordFailure(engine, error) {
    const state = this._getOrCreate(engine);
    const now = this.now();

    state.failures += 1;
    state.lastFailureAt = now;
    state.lastError = error ? error.message || String(error) : null;

    if (state.state === 'half_open' || state.failures >= this.failureThreshold) {
      state.state = 'open';
      state.openedAt = now;
    }
  }

  getState(engine) {
    return { ...this._getOrCreate(engine) };
  }

  getStats() {
    const stats = {};
    for (const [engine, state] of this.states.entries()) {
      stats[engine] = { ...state };
    }
    return stats;
  }

  reset(engine = null) {
    if (engine) {
      this.states.delete(engine);
      return;
    }

    this.states.clear();
  }
}

module.exports = EngineCircuitBreaker;
