const ActionRegistry = require('../modules/ifttt/action-registry');
const VariableStore = require('../modules/ifttt/variable-store');
const templateEngine = require('../modules/template-engine');

function createServices(extra = {}) {
  return {
    templateEngine,
    variables: new VariableStore({ info: jest.fn(), debug: jest.fn() }),
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    },
    ...extra
  };
}

describe('IFTTT action safety', () => {
  test('increments numeric variables instead of concatenating strings', async () => {
    const registry = new ActionRegistry({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
    const services = createServices();
    services.variables.set('score', '5');

    const result = await registry.execute(
      { type: 'variable:increment', name: 'score', amount: 1 },
      { data: {} },
      services
    );

    expect(result.success).toBe(true);
    expect(services.variables.get('score')).toBe(6);
  });

  test('clamps delay duration to the advertised maximum', async () => {
    const registry = new ActionRegistry({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });
    const services = createServices();
    let requestedDelay;
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
      requestedDelay = delay;
      callback();
      return 1;
    });

    const result = await registry.execute(
      { type: 'delay:wait', duration: 999999 },
      { data: {} },
      services
    );

    expect(result.success).toBe(true);
    expect(requestedDelay).toBe(60000);
    setTimeoutSpy.mockRestore();
  });
});
