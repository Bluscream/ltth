const fs = require('fs');
const path = require('path');

describe('Fireworks Dev Sidebar Integration', () => {
  let dashboardHtml;
  let enLocale;
  let deLocale;

  beforeAll(() => {
    dashboardHtml = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'dashboard.html'),
      'utf8'
    );
    enLocale = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'locales', 'en.json'), 'utf8')
    );
    deLocale = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'locales', 'de.json'), 'utf8')
    );
  });

  test('adds a separate fireworks-dev sidebar entry', () => {
    expect(dashboardHtml).toContain('data-view="fireworks-dev"');
    expect(dashboardHtml).toContain('data-plugin="fireworks-dev"');
  });

  test('adds a separate fireworks-dev dashboard view', () => {
    const viewSection = dashboardHtml.substring(
      dashboardHtml.indexOf('id="view-fireworks-dev"'),
      dashboardHtml.indexOf('id="view-fireworks-dev"') + 1000
    );

    expect(viewSection).toContain('data-plugin="fireworks-dev"');
    expect(viewSection).toContain('data-src="/fireworks-dev/ui"');
    expect(viewSection).toContain('href="/fireworks-dev/ui"');
  });

  test('keeps stable fireworks and dev fireworks as separate entries', () => {
    expect(dashboardHtml).toContain('data-view="fireworks"');
    expect(dashboardHtml).toContain('data-view="fireworks-dev"');
  });

  test('adds locale labels for fireworks-dev', () => {
    expect(enLocale.navigation.fireworks_dev).toBe('Fireworks Dev');
    expect(deLocale.navigation.fireworks_dev).toBe('Feuerwerk Dev');
  });
});
