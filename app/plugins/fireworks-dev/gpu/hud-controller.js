(function () {
  class HudController {
    constructor(rootEl) {
      this.rootEl = rootEl;
      this.hudEl = document.getElementById('fireworks-dev-hud');
      this.comboValueEl = document.getElementById('combo-count-value');
      this.comboLabelEl = document.getElementById('combo-label-value');
      this.encounterValueEl = document.getElementById('encounter-mode-value');
      this.themeValueEl = document.getElementById('theme-name-value');
      this.attackValueEl = document.getElementById('attack-class-value');
      this.qualityValueEl = document.getElementById('quality-profile-value');
      this.phaseValueEl = document.getElementById('phase-label-value');
      this.patternValueEl = document.getElementById('pattern-label-value');
      this.bossEnergyFillEl = document.getElementById('boss-energy-fill');
      this.bossEnergyLabelEl = document.getElementById('boss-energy-label');
      this.ultimateFillEl = document.getElementById('ultimate-charge-fill');
      this.ultimateLabelEl = document.getElementById('ultimate-label');
      this.bannerEl = document.getElementById('fireworks-dev-banner');
      this.followerEl = document.getElementById('fireworks-dev-follower');
    }

    setTheme(theme) {
      this.themeValueEl.textContent = theme.label;
      this.rootEl.dataset.theme = theme.key;
    }

    setVisible(enabled) {
      if (this.hudEl) {
        this.hudEl.style.display = enabled === false ? 'none' : 'flex';
      }
    }

    updateEncounter(state, profileName) {
      this.encounterValueEl.textContent = state.encounterLabel;
      this.comboValueEl.textContent = `${state.combo}x`;
      this.comboLabelEl.textContent = state.comboLabel;
      this.attackValueEl.textContent = state.attackLabel;
      this.qualityValueEl.textContent = (profileName || 'ultra').toUpperCase();
      this.phaseValueEl.textContent = state.phaseLabel;
      this.patternValueEl.textContent = state.patternLabel;
      this.rootEl.dataset.attackClass = state.attackClass;
      this.rootEl.style.setProperty('--combo-scale', String(Math.min(1.28, 1 + state.combo * 0.03)));
      this.bossEnergyFillEl.style.width = `${state.bossEnergy}%`;
      this.bossEnergyLabelEl.textContent = state.bossLabel;
      this.ultimateFillEl.style.width = `${state.ultimateCharge}%`;
      this.ultimateLabelEl.textContent = state.ultimateLabel;
    }

    showBanner(text) {
      const node = document.createElement('div');
      node.className = 'banner-pill';
      node.textContent = text;
      this.bannerEl.innerHTML = '';
      this.bannerEl.appendChild(node);
      setTimeout(() => {
        if (node.parentNode) {
          node.remove();
        }
      }, 1900);
    }

    showFollower(payload) {
      const card = document.createElement('div');
      card.className = 'follower-card';
      const avatar = payload.profilePictureUrl ? `<img src="${payload.profilePictureUrl}" alt="">` : '';
      card.innerHTML = `
        ${avatar}
        <div>
          <div class="hud-label">New Challenger</div>
          <div class="hud-value" style="font-size: 22px; transform: none;">${payload.username}</div>
          <div class="hud-subvalue">${payload.thankYouText || 'Entered the arena'}</div>
        </div>
      `;
      this.followerEl.innerHTML = '';
      this.followerEl.appendChild(card);
      setTimeout(() => {
        if (card.parentNode) {
          card.remove();
        }
      }, payload.duration || 2200);
    }
  }

  window.FireworksDevHudController = HudController;
})();
