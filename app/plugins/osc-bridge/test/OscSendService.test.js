const OscSendService = require('../modules/OscSendService');

describe('OscSendService', () => {
  test('returns a rich failure when bridge is not running', () => {
    const service = new OscSendService({
      getConfig: () => ({ parameterCaching: { enabled: false }, messageBatching: { enabled: false } }),
      getTransport: () => ({ state: 'stopped', isRunning: () => false }),
      logger: makeLogger(),
      emit: jest.fn()
    });

    const result = service.sendMessage('/avatar/parameters/Wave', [1]);

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'OSC bridge is not running',
      address: '/avatar/parameters/Wave',
      args: [1]
    }));
  });

  test('sends converted OSC args through transport when running', () => {
    const send = jest.fn();
    const emit = jest.fn();
    const service = new OscSendService({
      getConfig: () => ({ parameterCaching: { enabled: false }, messageBatching: { enabled: false } }),
      getTransport: () => ({ state: 'running', isRunning: () => true, send }),
      logger: makeLogger(),
      emit
    });

    const result = service.sendMessage('/avatar/parameters/Wave', [1, 0.5, 'ok', true, false]);

    expect(result.success).toBe(true);
    expect(send).toHaveBeenCalledWith({
      address: '/avatar/parameters/Wave',
      args: [
        { type: 'i', value: 1 },
        { type: 'f', value: 0.5 },
        { type: 's', value: 'ok' },
        { type: 'T' },
        { type: 'F' }
      ]
    });
    expect(emit).toHaveBeenCalledWith('osc:sent', expect.objectContaining({
      address: '/avatar/parameters/Wave',
      args: [1, 0.5, 'ok', true, false]
    }));
  });

  test('drops unsafe OSC addresses with a truthful error', () => {
    const service = new OscSendService({
      getConfig: () => ({ parameterCaching: { enabled: false }, messageBatching: { enabled: false } }),
      getTransport: () => ({ state: 'running', isRunning: () => true, send: jest.fn() }),
      logger: makeLogger(),
      emit: jest.fn()
    });

    expect(service.sendMessage('avatar/parameters/Wave', [1])).toEqual(expect.objectContaining({
      success: false,
      error: 'OSC address must start with /'
    }));
    expect(service.sendMessage('/avatar/../Wave', [1])).toEqual(expect.objectContaining({
      success: false,
      error: 'OSC address contains unsafe path characters'
    }));
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
