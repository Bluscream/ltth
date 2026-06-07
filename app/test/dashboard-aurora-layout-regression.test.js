const fs = require('fs');
const path = require('path');

describe('Dashboard Aurora layout regressions', () => {
  let navigationCss;
  let themesCss;
  let navigationJs;

  beforeAll(() => {
    navigationCss = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', 'navigation.css'),
      'utf8'
    );
    themesCss = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'css', 'themes.css'),
      'utf8'
    );
    navigationJs = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'js', 'navigation.js'),
      'utf8'
    );
  });

  test('aurora theme does not override the sidebar into normal document flow', () => {
    expect(themesCss).not.toMatch(
      /\.sidebar,\s*\n:is\(html:not\(\[data-theme\]\), \[data-theme="aurora"\]\) \.topbar,\s*\n:is\(html:not\(\[data-theme\]\), \[data-theme="aurora"\]\) \.main-content\s*{\s*position:\s*relative;/m
    );
  });

  test('tablet breakpoint lets the topbar wrap instead of crushing the title', () => {
    expect(navigationCss).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*?\.topbar\s*{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?height:\s*auto;/m
    );
    expect(navigationCss).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*?\.topbar-right\s*{[\s\S]*?flex-wrap:\s*wrap;/m
    );
    expect(navigationCss).toMatch(
      /@media \(max-width: 1024px\)[\s\S]*?\.topbar-left,\s*\n\s*\.topbar-right\s*{[\s\S]*?width:\s*100%;/m
    );
  });

  test('mobile menu initialization is idempotent', () => {
    expect(navigationJs).toContain("document.getElementById('mobile-menu-btn')");
    expect(navigationJs).toMatch(
      /if\s*\(\s*document\.getElementById\('mobile-menu-btn'\)\s*\)\s*return;/
    );
  });

  test('mobile menu button is exempt from the outside-click sidebar closer', () => {
    expect(navigationJs).toContain("const mobileMenuBtn = document.getElementById('mobile-menu-btn');");
    expect(navigationJs).toContain('const clickedMobileToggle = mobileMenuBtn && mobileMenuBtn.contains(e.target);');
    expect(navigationJs).toContain("!clickedInsideSidebar && !clickedToggle && !clickedMobileToggle");
  });

  test('expanded sidebar category headers do not create horizontal overflow with negative margins', () => {
    expect(navigationCss).toMatch(/\.sidebar-category-header\s*{[\s\S]*?margin:\s*0\s+0\s+0\.25rem\s+0;/m);
    expect(navigationCss).not.toMatch(/\.sidebar-category-header\s*{[\s\S]*?margin:\s*0\s+-0\.5rem\s+0\.25rem\s+-0\.5rem;/m);
  });

  test('expanded sidebar item labels may wrap instead of being hard-truncated', () => {
    expect(navigationCss).toMatch(/\.sidebar-item-text\s*{[\s\S]*?display:\s*block;/m);
    expect(navigationCss).toMatch(/\.sidebar-item-text\s*{[\s\S]*?flex:\s*1;/m);
    expect(navigationCss).toMatch(/\.sidebar-item-text\s*{[\s\S]*?min-width:\s*0;/m);
    expect(navigationCss).toMatch(/\.sidebar-item-text\s*{[\s\S]*?white-space:\s*normal;/m);
  });
});
