(function () {
  const THEMES = {
    'inferno-siege': {
      key: 'inferno-siege',
      label: 'Inferno Siege',
      primary: '#ff7a18',
      secondary: '#ff3d00',
      accent: '#ffd166',
      background: 'linear-gradient(180deg, rgba(34, 10, 5, 0.96), rgba(15, 6, 4, 0.92))',
      grid: 'rgba(255, 183, 77, 0.12)',
      fog: 'rgba(255, 115, 0, 0.16)',
      stars: 'rgba(255, 245, 210, 0.07)',
      sigil: 'rgba(255, 209, 102, 0.12)',
      pulse: 'rgba(255, 122, 24, 0.28)',
      ribbon: 'linear-gradient(90deg, #ff7a18, #ffd166)',
      hudShell: 'linear-gradient(135deg, rgba(12, 9, 10, 0.78), rgba(255, 160, 64, 0.08))',
      hudBorder: 'rgba(255, 209, 102, 0.22)',
      bannerGlow: 'rgba(255, 122, 24, 0.34)',
      flashColor: 'rgba(255, 180, 80, 0.62)',
      smokeColor: 'radial-gradient(circle, rgba(255, 196, 148, 0.28), rgba(255, 120, 0, 0.02))',
      palette: ['#ff7a18', '#ff5400', '#ffd166', '#ffcf56']
    },
    'neon-reactor': {
      key: 'neon-reactor',
      label: 'Neon Reactor',
      primary: '#00d4ff',
      secondary: '#8b5cf6',
      accent: '#5bffb6',
      background: 'linear-gradient(180deg, rgba(6, 12, 32, 0.97), rgba(3, 8, 24, 0.9))',
      grid: 'rgba(0, 212, 255, 0.12)',
      fog: 'rgba(59, 130, 246, 0.12)',
      stars: 'rgba(210, 244, 255, 0.08)',
      sigil: 'rgba(91, 255, 182, 0.11)',
      pulse: 'rgba(0, 212, 255, 0.24)',
      ribbon: 'linear-gradient(90deg, #00d4ff, #8b5cf6)',
      hudShell: 'linear-gradient(135deg, rgba(7, 12, 22, 0.8), rgba(0, 212, 255, 0.06))',
      hudBorder: 'rgba(91, 255, 182, 0.18)',
      bannerGlow: 'rgba(0, 212, 255, 0.26)',
      flashColor: 'rgba(91, 255, 182, 0.5)',
      smokeColor: 'radial-gradient(circle, rgba(91, 255, 182, 0.22), rgba(0, 212, 255, 0.03))',
      palette: ['#00d4ff', '#8b5cf6', '#5bffb6', '#f72585']
    },
    'celestial-titan': {
      key: 'celestial-titan',
      label: 'Celestial Titan',
      primary: '#7dd3fc',
      secondary: '#c084fc',
      accent: '#f8fafc',
      background: 'linear-gradient(180deg, rgba(8, 16, 40, 0.97), rgba(5, 8, 24, 0.92))',
      grid: 'rgba(192, 132, 252, 0.12)',
      fog: 'rgba(125, 211, 252, 0.13)',
      stars: 'rgba(248, 250, 252, 0.11)',
      sigil: 'rgba(192, 132, 252, 0.12)',
      pulse: 'rgba(192, 132, 252, 0.24)',
      ribbon: 'linear-gradient(90deg, #7dd3fc, #c084fc)',
      hudShell: 'linear-gradient(135deg, rgba(8, 14, 34, 0.8), rgba(192, 132, 252, 0.08))',
      hudBorder: 'rgba(248, 250, 252, 0.18)',
      bannerGlow: 'rgba(192, 132, 252, 0.28)',
      flashColor: 'rgba(248, 250, 252, 0.54)',
      smokeColor: 'radial-gradient(circle, rgba(248, 250, 252, 0.26), rgba(192, 132, 252, 0.03))',
      palette: ['#7dd3fc', '#c084fc', '#f8fafc', '#fde68a']
    }
  };

  class ThemeManager {
    constructor(rootEl, themeLayerEl) {
      this.rootEl = rootEl;
      this.themeLayerEl = themeLayerEl;
      this.currentTheme = 'inferno-siege';
      this.backdropEnabled = true;
      this.backdropOpacity = 0.92;
      this.layerVisibility = {
        sky: true,
        stars: true,
        grid: true,
        sigil: true,
        fog: true
      };
      this.layerOpacity = {
        sky: 1,
        stars: 0.85,
        grid: 0.92,
        sigil: 0.7,
        fog: 1
      };
    }

    getTheme(name) {
      return THEMES[name] || THEMES['inferno-siege'];
    }

    setBackdropEnabled(enabled) {
      this.backdropEnabled = enabled !== false;
      this.applyBackdropState();
    }

    setBackdropOpacity(opacity) {
      const parsedOpacity = Number(opacity);
      this.backdropOpacity = Number.isFinite(parsedOpacity)
        ? Math.max(0, Math.min(1, parsedOpacity))
        : 0.92;
      this.applyBackdropState();
    }

    setLayerConfig(layerVisibility = {}, layerOpacity = {}) {
      this.layerVisibility = { ...this.layerVisibility, ...layerVisibility };
      this.layerOpacity = { ...this.layerOpacity, ...layerOpacity };
      this.applyBackdropState();
    }

    applyBackdropState() {
      const backdropOpacity = this.backdropEnabled ? this.backdropOpacity : 0;
      this.rootEl.style.setProperty('--scene-backdrop-opacity', String(backdropOpacity));
      this.themeLayerEl.style.opacity = String(backdropOpacity);

      ['sky', 'stars', 'grid', 'sigil', 'fog'].forEach((layer) => {
        const visible = this.backdropEnabled && this.layerVisibility[layer] !== false;
        const opacity = visible ? Math.max(0, Math.min(1, Number(this.layerOpacity[layer]) || 0)) : 0;
        this.rootEl.style.setProperty(`--scene-layer-${layer}-opacity`, String(opacity));
      });
    }

    applyTheme(name) {
      this.currentTheme = THEMES[name] ? name : 'inferno-siege';
      const theme = this.getTheme(this.currentTheme);

      this.rootEl.dataset.theme = this.currentTheme;
      this.rootEl.style.setProperty('--fx-primary', theme.primary);
      this.rootEl.style.setProperty('--fx-secondary', theme.secondary);
      this.rootEl.style.setProperty('--fx-accent', theme.accent);
      this.rootEl.style.setProperty('--fx-bg', theme.background);
      this.rootEl.style.setProperty('--theme-grid', theme.grid);
      this.rootEl.style.setProperty('--theme-fog', theme.fog);
      this.rootEl.style.setProperty('--theme-stars', theme.stars);
      this.rootEl.style.setProperty('--theme-sigil', theme.sigil);
      this.rootEl.style.setProperty('--theme-pulse', theme.pulse);
      this.rootEl.style.setProperty('--hud-shell', theme.hudShell);
      this.rootEl.style.setProperty('--hud-border', theme.hudBorder);
      this.rootEl.style.setProperty('--banner-glow', theme.bannerGlow);
      this.themeLayerEl.style.background = theme.background;
      this.applyBackdropState();

      return theme;
    }
  }

  window.FireworksDevThemeManager = ThemeManager;
})();
