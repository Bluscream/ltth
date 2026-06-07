const EulerstreamAdapter = require('../modules/adapters/EulerstreamAdapter');

function createAdapter() {
  return new EulerstreamAdapter(
    { emit: jest.fn() },
    { loadStreamStats: jest.fn(() => null) },
    {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
  );
}

describe('Eulerstream gift repeat count extraction', () => {
  test('uses top-level amount as repeatCount when repeatCount is missing', () => {
    const adapter = createAdapter();

    const gift = adapter.extractGiftData({
      giftName: 'Rose',
      giftId: '5655',
      diamondCount: 1,
      giftType: 1,
      repeatEnd: true,
      amount: 20
    });

    expect(gift.repeatCount).toBe(20);
  });

  test('derives repeatCount from total amount and diamondCount for multi-coin gifts', () => {
    const adapter = createAdapter();

    const gift = adapter.extractGiftData({
      giftName: 'Perfume',
      giftId: '5658',
      diamondCount: 20,
      giftType: 1,
      repeatEnd: true,
      amount: 20
    });

    expect(gift.repeatCount).toBe(1);
  });

  test('uses nested gift repeatCount when top-level repeatCount is missing', () => {
    const adapter = createAdapter();

    const gift = adapter.extractGiftData({
      giftDetails: {
        id: '5655',
        name: 'Rose',
        diamondCount: 1,
        repeatCount: 20,
        giftType: 1
      },
      repeatEnd: true
    });

    expect(gift.repeatCount).toBe(20);
  });
});
