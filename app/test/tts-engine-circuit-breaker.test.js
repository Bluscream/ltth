const EngineCircuitBreaker = require('../plugins/tts/utils/engine-circuit-breaker');

describe('TTS engine circuit breaker', () => {
  let now;
  let breaker;

  beforeEach(() => {
    now = 1000;
    breaker = new EngineCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 5000,
      now: () => now
    });
  });

  test('opens after consecutive failures and blocks calls until cooldown expires', () => {
    breaker.recordFailure('google', new Error('timeout'));
    expect(breaker.canCall('google')).toBe(true);

    breaker.recordFailure('google', new Error('timeout again'));
    expect(breaker.canCall('google')).toBe(false);
    expect(breaker.getState('google').state).toBe('open');

    now += 5000;

    expect(breaker.canCall('google')).toBe(true);
    expect(breaker.getState('google').state).toBe('half_open');
  });

  test('success in half-open state closes the circuit and resets failures', () => {
    breaker.recordFailure('openai', new Error('network'));
    breaker.recordFailure('openai', new Error('network'));
    now += 5000;
    breaker.canCall('openai');

    breaker.recordSuccess('openai');

    expect(breaker.getState('openai')).toMatchObject({
      state: 'closed',
      failures: 0
    });
    expect(breaker.canCall('openai')).toBe(true);
  });

  test('failure in half-open state reopens the circuit', () => {
    breaker.recordFailure('speechify', new Error('429'));
    breaker.recordFailure('speechify', new Error('429'));
    now += 5000;
    breaker.canCall('speechify');

    breaker.recordFailure('speechify', new Error('429'));

    expect(breaker.canCall('speechify')).toBe(false);
    expect(breaker.getState('speechify').state).toBe('open');
  });
});
