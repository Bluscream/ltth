const templateEngine = require('../modules/template-engine');

describe('Template engine IFTTT placeholders', () => {
  test('renders both single and double brace placeholders without stray braces', () => {
    const output = templateEngine.render(
      'Danke {{username}} fuer {giftName}',
      { username: 'Alice', giftName: 'Rose' }
    );

    expect(output).toBe('Danke Alice fuer Rose');
  });

  test('replaces missing single and double brace placeholders with default value', () => {
    const output = templateEngine.render(
      'Hallo {{username}} {giftName}',
      {},
      { defaultValue: '-' }
    );

    expect(output).toBe('Hallo - -');
  });
});
