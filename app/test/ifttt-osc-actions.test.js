const ActionRegistry = require('../modules/ifttt/action-registry');

describe('IFTTT OSC actions', () => {
  let registry;
  let services;

  beforeEach(() => {
    registry = new ActionRegistry();
    services = {
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
      }
    };
  });

  test('osc:send throws when the OSC service send method reports failure', async () => {
    services.osc = {
      send: jest.fn(() => false)
    };

    await expect(registry.get('osc:send').executor({
      address: '/avatar/parameters/Wave',
      args: '[1]'
    }, {}, services)).rejects.toThrow('OSC send failed');
  });

  test('osc:vrchat:wave throws when the helper reports failure', async () => {
    services.osc = {
      wave: jest.fn(() => false)
    };

    await expect(registry.get('osc:vrchat:wave').executor({
      duration: 1000
    }, {}, services)).rejects.toThrow('OSC action failed: wave');
  });
});
