const IFTTTEngine = require('../modules/ifttt/ifttt-engine');

function createEngine() {
  const db = {
    getSetting: jest.fn(() => 'true'),
    getEnabledFlows: jest.fn(() => []),
    getFlows: jest.fn(() => [])
  };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  return new IFTTTEngine(db, logger, { db, io: { emit: jest.fn() }, alertManager: {} });
}

describe('IFTTT condition evaluation', () => {
  test('evaluates wizard AND condition trees that contain legacy field conditions', () => {
    const engine = createEngine();
    const context = engine.variables.createContext({
      coins: 50,
      username: 'alice'
    });

    const conditionTree = {
      logic: 'AND',
      conditions: [
        { field: 'coins', operator: 'greater_or_equal', value: 50 },
        { field: 'username', operator: 'equals', value: 'alice' }
      ]
    };

    expect(engine.evaluateConditions(conditionTree, context)).toBe(true);
  });

  test('evaluates field_value registry conditions against event data', () => {
    const engine = createEngine();
    const context = engine.variables.createContext({
      giftName: 'Rose',
      coins: 10
    });

    const conditionTree = {
      logic: 'AND',
      conditions: [
        {
          type: 'field_value',
          field: 'giftName',
          operator: 'equals',
          value: 'Rose'
        },
        {
          type: 'field_value',
          field: 'coins',
          operator: 'greater_than',
          value: 5
        }
      ]
    };

    expect(engine.evaluateConditions(conditionTree, context)).toBe(true);
  });

  test('returns false when a legacy leaf in a complex tree does not match', () => {
    const engine = createEngine();
    const context = engine.variables.createContext({
      coins: 20,
      username: 'alice'
    });

    const conditionTree = {
      logic: 'AND',
      conditions: [
        { field: 'coins', operator: 'greater_than', value: 50 },
        { field: 'username', operator: 'equals', value: 'alice' }
      ]
    };

    expect(engine.evaluateConditions(conditionTree, context)).toBe(false);
  });

  test('evaluates built-in condition fields as exposed to the frontend', () => {
    const engine = createEngine();
    engine.variables.set('hypeMode', 'on');
    jest.spyOn(Math, 'random').mockReturnValue(0.75);

    const context = engine.variables.createContext({
      username: 'alice',
      level: 4,
      isFollower: true
    });

    const conditionTree = {
      logic: 'AND',
      conditions: [
        { type: 'username_check', operator: 'equals', username: 'alice' },
        { type: 'user_level', operator: 'greater_or_equal', level: 4 },
        { type: 'user_follower', isFollower: true },
        { type: 'variable_check', variableName: 'hypeMode', operator: 'equals', value: 'on' },
        { type: 'random_chance', percentage: 80 }
      ]
    };

    expect(engine.evaluateConditions(conditionTree, context)).toBe(true);

    Math.random.mockRestore();
  });

  test('tracks cooldown and rate limit conditions between evaluations', () => {
    const engine = createEngine();

    const cooldown = { type: 'cooldown', key: 'chat-command', seconds: 60 };
    const rateLimit = { type: 'rate_limit', key: 'likes', maxCount: 1, windowSeconds: 60 };

    expect(engine.evaluateConditions(cooldown, engine.variables.createContext({}))).toBe(true);
    expect(engine.evaluateConditions(cooldown, engine.variables.createContext({}))).toBe(false);

    expect(engine.evaluateConditions(rateLimit, engine.variables.createContext({}))).toBe(true);
    expect(engine.evaluateConditions(rateLimit, engine.variables.createContext({}))).toBe(false);
  });

  test('accepts wizard lowercase logic and camelCase operator aliases', () => {
    const engine = createEngine();
    const context = engine.variables.createContext({
      coins: 100,
      username: 'alice'
    });

    const conditionTree = {
      logic: 'and',
      conditions: [
        { field: 'coins', operator: 'greaterThanOrEqual', value: 100 },
        { field: 'username', operator: 'startsWith', value: 'ali' }
      ]
    };

    expect(engine.evaluateConditions(conditionTree, context)).toBe(true);
  });

  test('normalizes boolean/list/string operators for frontend field values', () => {
    const engine = createEngine();
    const context = engine.variables.createContext({
      flag: 'false',
      rank: 1
    });

    expect(engine.evaluateConditions({ field: 'missing', operator: 'contains', value: 'defined' }, context)).toBe(false);
    expect(engine.evaluateConditions({ field: 'flag', operator: 'is_false' }, context)).toBe(true);
    expect(engine.evaluateConditions({ field: 'rank', operator: 'in_list', value: [1, 2] }, context)).toBe(true);
  });

  test('frontend operator metadata exposes display names', () => {
    const engine = createEngine();
    const operators = engine.conditions.getAllOperatorsForFrontend();

    expect(operators.find(op => op.id === 'greater_than')).toMatchObject({
      id: 'greater_than',
      name: 'Greater Than'
    });
  });
});
