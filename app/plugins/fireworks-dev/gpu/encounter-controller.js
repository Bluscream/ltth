(function () {
  const MODE_FACTORS = {
    skirmish: { energy: 1, charge: 1, decay: 0.024 },
    raid: { energy: 1.2, charge: 1.1, decay: 0.018 },
    finale: { energy: 1.38, charge: 1.26, decay: 0.012 }
  };

  class EncounterController {
    constructor() {
      this.combo = 0;
      this.bossEnergy = 14;
      this.ultimateCharge = 0;
      this.encounterMode = 'skirmish';
      this.phaseIndex = 1;
      this.attackClass = 'skirmish';
    }

    setEncounterMode(mode) {
      this.encounterMode = MODE_FACTORS[mode] ? mode : 'skirmish';
    }

    handleTrigger(payload) {
      const mode = MODE_FACTORS[payload.encounterMode] ? payload.encounterMode : this.encounterMode;
      const factors = MODE_FACTORS[mode];
      const intensity = Math.max(0.4, payload.intensity || 1);
      const comboBase = payload.combo || this.combo + 1;

      this.encounterMode = mode;
      this.combo = Math.max(1, comboBase);
      this.bossEnergy = Math.min(100, this.bossEnergy + (intensity * 7 + Math.min(12, this.combo * 0.85)) * factors.energy);
      this.ultimateCharge = Math.min(100, this.ultimateCharge + (intensity * 9 + Math.min(18, this.combo)) * factors.charge);

      if (payload.ultimateTier || this.ultimateCharge >= 100) {
        this.ultimateCharge = 100;
      }

      this.phaseIndex = this.bossEnergy >= 82 ? 3 : this.bossEnergy >= 46 ? 2 : 1;
      this.attackClass = this.resolveAttackClass(payload, intensity);

      return this.getState(this.attackClass, payload.hudLabel);
    }

    resolveAttackClass(payload, intensity) {
      if (payload.ultimateTier || this.ultimateCharge >= 100) {
        return 'ultimate';
      }
      if (this.phaseIndex >= 3 || intensity >= 3 || this.combo >= 10) {
        return 'cataclysm';
      }
      if (intensity >= 2 || this.combo >= 6) {
        return 'raid';
      }
      if (intensity >= 1.25 || this.combo >= 3) {
        return 'assault';
      }
      return 'skirmish';
    }

    decay() {
      const factors = MODE_FACTORS[this.encounterMode] || MODE_FACTORS.skirmish;
      this.bossEnergy = Math.max(0, this.bossEnergy - factors.decay);
      if (this.combo > 0 && this.bossEnergy < 6) {
        this.combo = Math.max(0, this.combo - 0.015);
      }
      this.phaseIndex = this.bossEnergy >= 82 ? 3 : this.bossEnergy >= 46 ? 2 : 1;
    }

    consumeUltimate() {
      this.ultimateCharge = 0;
    }

    getState(attackClass, hudLabel) {
      const encounterLabel = this.encounterMode.charAt(0).toUpperCase() + this.encounterMode.slice(1);
      const roundedCombo = Math.max(0, Math.round(this.combo));
      const comboLabel = hudLabel || (
        attackClass === 'ultimate' ? 'Ultimate payload engaged'
          : attackClass === 'cataclysm' ? 'Cataclysm barrage'
            : attackClass === 'raid' ? 'Raid attack pattern'
              : attackClass === 'assault' ? 'Heavy impact'
                : 'Arena pressure rising'
      );
      const patternLabel = attackClass === 'ultimate'
        ? 'Omega Sigil'
        : attackClass === 'cataclysm'
          ? 'Nova Breaker'
          : attackClass === 'raid'
            ? 'Crossfire'
            : attackClass === 'assault'
              ? 'Pulse Fan'
              : 'Arena Idle';

      return {
        combo: roundedCombo,
        encounterLabel,
        comboLabel,
        bossEnergy: Math.round(this.bossEnergy),
        bossLabel: this.bossEnergy >= 80 ? 'Boss attack imminent' : this.bossEnergy >= 46 ? 'Pressure climbing' : 'Attack pattern warming up',
        ultimateCharge: Math.round(this.ultimateCharge),
        ultimateLabel: this.ultimateCharge >= 100 ? 'Ultimate ready' : 'Ultimate charging',
        attackClass,
        attackLabel: attackClass.charAt(0).toUpperCase() + attackClass.slice(1),
        phaseLabel: `Phase ${this.phaseIndex}`,
        patternLabel
      };
    }
  }

  window.FireworksDevEncounterController = EncounterController;
})();
