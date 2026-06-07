/**
 * Regression tests for soundboard queue length enforcement.
 *
 * dashboard-soundboard.js runs in a browser block scope, so these tests
 * instrument the source before the final closing brace and exercise the
 * actual queue functions with browser/socket stubs.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElementStub() {
  return {
    style: {},
    children: [],
    classList: {
      add: jest.fn(),
      remove: jest.fn(),
      toggle: jest.fn(),
      contains: jest.fn(() => false)
    },
    appendChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter(item => item !== child);
    },
    remove: jest.fn(),
    addEventListener: jest.fn(),
    set textContent(value) {
      this._textContent = value;
      this.innerHTML = value;
    },
    get textContent() {
      return this._textContent || '';
    },
    innerHTML: ''
  };
}

function createHarness() {
  const filePath = path.join(__dirname, '../public/js/dashboard-soundboard.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const instrumentation = `
globalThis.__soundboardQueueTest = {
  setMode(mode) { currentPlayMode = mode; },
  setMaxQueueLength(value) { currentMaxQueueLength = value; },
  setPlaySoundStub(fn) { playSound = fn; },
  playDashboardSoundboard,
  clearAllQueues,
  getGlobalQueueLength() { return globalSoundQueue.length; },
  getPerGiftQueueLength(queueKey) {
    return perGiftSoundQueues[queueKey] ? perGiftSoundQueues[queueKey].queue.length : 0;
  }
};
`;
  const instrumented = source.replace(/\n}\s*$/, `${instrumentation}\n}`);

  if (instrumented === source) {
    throw new Error('Could not instrument dashboard-soundboard.js');
  }

  const socket = {
    id: 'test-socket',
    on: jest.fn(),
    emit: jest.fn()
  };
  const documentStub = {
    body: createElementStub(),
    addEventListener: jest.fn(),
    createElement: jest.fn(() => createElementStub()),
    getElementById: jest.fn(() => null),
    querySelector: jest.fn(() => null),
    querySelectorAll: jest.fn(() => [])
  };
  const context = {
    URL,
    console,
    setTimeout,
    clearTimeout,
    window: {
      socket,
      location: { origin: 'http://localhost:3000' }
    },
    document: documentStub,
    navigator: {},
    io: jest.fn(() => socket),
    fetch: jest.fn(),
    alert: jest.fn(),
    FrontendLogger: {
      createLogger: jest.fn(() => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }))
    }
  };

  vm.runInNewContext(instrumented, context);
  return context.__soundboardQueueTest;
}

describe('Soundboard queue limit enforcement', () => {
  test('queue-all mode does not exceed the configured waiting queue length', () => {
    const harness = createHarness();
    const playing = [];

    harness.setMode('queue-all');
    harness.setMaxQueueLength(2);
    harness.setPlaySoundStub((data, onComplete) => {
      playing.push({ data, onComplete });
    });

    ['one', 'two', 'three', 'four'].forEach(label => {
      harness.playDashboardSoundboard({
        url: `/sounds/${label}.mp3`,
        label,
        eventType: 'gift',
        giftId: 1
      });
    });

    expect(playing).toHaveLength(1);
    expect(harness.getGlobalQueueLength()).toBe(2);
  });

  test('queue-per-gift mode limits each gift queue independently', () => {
    const harness = createHarness();

    harness.setMode('queue-per-gift');
    harness.setMaxQueueLength(1);
    harness.setPlaySoundStub(() => {});

    ['one', 'two', 'three'].forEach(label => {
      harness.playDashboardSoundboard({
        url: `/sounds/${label}.mp3`,
        label,
        eventType: 'gift',
        giftId: 7
      });
    });

    expect(harness.getPerGiftQueueLength('gift-7')).toBe(1);
  });
});

describe('Soundboard gift repeat playback in the frontend queue', () => {
  test('overlap mode plays a gift sound once per repeatCount', () => {
    const harness = createHarness();
    const played = [];

    harness.setMode('overlap');
    harness.setPlaySoundStub((data) => {
      played.push(data);
    });

    harness.playDashboardSoundboard({
      url: '/sounds/rose.mp3',
      label: 'Rose Sound',
      eventType: 'gift',
      giftId: 5655,
      repeatCount: 20
    });

    expect(played).toHaveLength(20);
  });

  test('queue-all mode queues every repeat from a gift streak', () => {
    const harness = createHarness();
    const playing = [];

    harness.setMode('queue-all');
    harness.setMaxQueueLength(10);
    harness.setPlaySoundStub((data, onComplete) => {
      playing.push({ data, onComplete });
    });

    harness.playDashboardSoundboard({
      url: '/sounds/rose.mp3',
      label: 'Rose Sound',
      eventType: 'gift',
      giftId: 5655,
      repeatCount: 20
    });

    expect(playing).toHaveLength(1);
    expect(harness.getGlobalQueueLength()).toBe(19);
  });

  test('gift repeat playback is capped at 50 plays', () => {
    const harness = createHarness();
    const played = [];

    harness.setMode('overlap');
    harness.setPlaySoundStub((data) => {
      played.push(data);
    });

    harness.playDashboardSoundboard({
      url: '/sounds/rose.mp3',
      label: 'Rose Sound',
      eventType: 'gift',
      giftId: 5655,
      repeatCount: 200
    });

    expect(played).toHaveLength(50);
  });
});
