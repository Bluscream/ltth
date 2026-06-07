const QueueManager = require('../plugins/tts/utils/queue-manager');

describe('TTS queue aging and adaptive pre-generation', () => {
  let queueManager;
  let mockLogger;
  let now;
  let dateSpy;

  beforeEach(() => {
    now = 1000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    queueManager = new QueueManager({
      maxQueueSize: 100,
      rateLimit: 100,
      rateLimitWindow: 60,
      priorityAgingEnabled: true,
      priorityAgingIntervalMs: 1000,
      priorityAgingBoost: 10,
      maxPriorityAgingBoost: 100,
      adaptivePreGeneration: true,
      preGenerateCount: 3,
      calmQueueThreshold: 2,
      calmPreGenerateCount: 5,
      minPreGenerateCount: 1,
      preGenerationErrorThreshold: 0.5
    }, mockLogger);
  });

  afterEach(() => {
    if (queueManager) {
      queueManager.stopProcessing();
      queueManager.clear();
    }
    dateSpy.mockRestore();
  });

  test('priority aging lets an old normal message overtake a newer high priority item', () => {
    queueManager.enqueue({
      userId: 'normal-user',
      username: 'NormalUser',
      text: 'normal chat',
      voice: 'voice',
      engine: 'tiktok',
      priority: 0
    });

    now += 10000;

    queueManager.enqueue({
      userId: 'gift-user',
      username: 'GiftUser',
      text: 'gift event',
      voice: 'voice',
      engine: 'tiktok',
      priority: 50
    });

    expect(queueManager.peek(1)[0].username).toBe('NormalUser');
  });

  test('adaptive pre-generation increases count for calm queues', () => {
    queueManager.enqueue({
      userId: 'u1',
      username: 'User1',
      text: 'one',
      voice: 'voice',
      engine: 'tiktok'
    });

    expect(queueManager._getAdaptivePreGenerateCount()).toBe(5);
  });

  test('adaptive pre-generation reduces count when pre-generation error rate is high', () => {
    queueManager.stats.preGenerationHits = 1;
    queueManager.stats.preGenerationMisses = 1;
    queueManager.stats.preGenerationErrors = 5;

    expect(queueManager._getAdaptivePreGenerateCount()).toBe(1);
  });
});
