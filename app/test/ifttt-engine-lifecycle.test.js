const IFTTTEngine = require('../modules/ifttt/ifttt-engine');

function createEngine({ settingValue = 'true', flows = [] } = {}) {
  const db = {
    getSetting: jest.fn((key) => (key === 'flows_enabled' ? settingValue : null)),
    getEnabledFlows: jest.fn(() => flows),
    getFlows: jest.fn(() => flows),
    getFlow: jest.fn((id) => flows.find(flow => String(flow.id) === String(id)) || null)
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };
  const engine = new IFTTTEngine(db, logger, { db, io: { emit: jest.fn() }, alertManager: {} });
  return { engine, db, logger };
}

describe('IFTTT engine lifecycle', () => {
  test('direct flow execution honors the global flows_enabled setting', async () => {
    const { engine } = createEngine({ settingValue: 'false' });
    engine.actions.execute = jest.fn(async () => ({ success: true }));

    await engine.executeFlow({
      id: 1,
      name: 'Disabled globally',
      enabled: true,
      actions: [{ type: 'log:write', message: 'ignored' }]
    });

    expect(engine.actions.execute).not.toHaveBeenCalled();
  });

  test('direct flow execution skips disabled flows', async () => {
    const { engine } = createEngine();
    engine.actions.execute = jest.fn(async () => ({ success: true }));

    await engine.executeFlow({
      id: 1,
      name: 'Disabled flow',
      enabled: false,
      actions: [{ type: 'log:write', message: 'ignored' }]
    });

    expect(engine.actions.execute).not.toHaveBeenCalled();
  });

  test('parallel matching flows do not block each other through shared execution depth', async () => {
    const flows = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      name: `Flow ${index + 1}`,
      enabled: true,
      trigger_type: 'tiktok:gift',
      actions: [{ type: 'log:write', message: 'ok' }]
    }));
    const { engine } = createEngine({ flows });
    const resolvers = [];
    engine.actions.execute = jest.fn(() => new Promise(resolve => {
      resolvers.push(() => resolve({ success: true }));
    }));

    const processing = engine.processEvent('tiktok:gift', { username: 'alice' });
    await Promise.resolve();

    expect(engine.actions.execute).toHaveBeenCalledTimes(11);

    resolvers.forEach(resolve => resolve());
    await processing;
  });
});
