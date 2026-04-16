const Database = require('better-sqlite3');
const CoinBattleDatabase = require('../backend/database');

describe('CoinBattleDatabase initialization', () => {
  let rawDb;
  let db;

  const logger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    rawDb = new Database(':memory:');
    db = new CoinBattleDatabase(rawDb, logger);
  });

  afterEach(() => {
    if (rawDb) {
      rawDb.close();
    }
    jest.clearAllMocks();
  });

  test('creates coinbattle_archived_matches table during initialization', () => {
    db.initializeTables();

    const archivedTable = rawDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'coinbattle_archived_matches'
    `).get();

    expect(archivedTable).toBeDefined();
  });
});
