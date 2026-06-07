jest.mock('osc', () => ({
  UDPPort: jest.fn(),
  timeTag: jest.fn(() => ({ raw: [0, 1] }))
}));

const EventEmitter = require('events');
const osc = require('osc');
const OscUdpTransport = require('../modules/OscUdpTransport');

class FakeUDPPort extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.close = jest.fn(() => {
      this.emit('close');
    });
    this.open = jest.fn(() => {
      setTimeout(() => this.emit('ready'), 25);
    });
    this.send = jest.fn();
  }
}

describe('OscUdpTransport', () => {
  beforeEach(() => {
    osc.UDPPort.mockImplementation((options) => new FakeUDPPort(options));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('start resolves only after UDP ready event', async () => {
    const transport = new OscUdpTransport({ logger: makeLogger() });
    const startPromise = transport.start({
      receivePort: 9001,
      sendHost: '127.0.0.1',
      sendPort: 9000
    });

    expect(transport.state).toBe('starting');

    const result = await startPromise;

    expect(result.success).toBe(true);
    expect(transport.state).toBe('running');
    expect(osc.UDPPort).toHaveBeenCalledWith(expect.objectContaining({
      localAddress: '0.0.0.0',
      localPort: 9001,
      remoteAddress: '127.0.0.1',
      remotePort: 9000,
      metadata: true
    }));
  });

  test('start returns failure and clears port when UDP emits an error before ready', async () => {
    osc.UDPPort.mockImplementation((options) => {
      const port = new FakeUDPPort(options);
      port.open = jest.fn(() => {
        setTimeout(() => port.emit('error', Object.assign(new Error('Port busy'), { code: 'EADDRINUSE' })), 5);
      });
      return port;
    });

    const transport = new OscUdpTransport({ logger: makeLogger() });
    const result = await transport.start({
      receivePort: 9001,
      sendHost: '127.0.0.1',
      sendPort: 9000
    });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Port busy',
      code: 'EADDRINUSE'
    }));
    expect(transport.state).toBe('error');
    expect(transport.port).toBeNull();
  });

  test('stop is idempotent while stopped and after running', async () => {
    const transport = new OscUdpTransport({ logger: makeLogger() });

    await expect(transport.stop()).resolves.toEqual({ success: true, alreadyStopped: true });

    await transport.start({
      receivePort: 9001,
      sendHost: '127.0.0.1',
      sendPort: 9000
    });

    await expect(transport.stop()).resolves.toEqual({ success: true });
    await expect(transport.stop()).resolves.toEqual({ success: true, alreadyStopped: true });
    expect(transport.state).toBe('stopped');
    expect(transport.port).toBeNull();
  });
});

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
}
