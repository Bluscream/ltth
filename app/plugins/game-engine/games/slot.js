/**
 * Slot Machine Game Logic
 *
 * Three-reel, server-authoritative slot engine.
 * Triggered via chat commands or gift events.
 * Supports configurable symbol sets, odds profiles per trigger context,
 * per-user cooldowns, and a reward dispatcher that can fire
 * OpenShock, audio, overlay effects, and XP grants.
 *
 * Architecture note:
 *   - SlotGame is instantiated by GameEnginePlugin (main.js) and receives
 *     the shared PluginAPI, GameEngineDatabase, and logger instances –
 *     exactly the same pattern used by WheelGame and PlinkoGame.
 *   - The UnifiedQueueManager is wired in after construction via setUnifiedQueue().
 *   - All RNG is performed server-side; the overlay only animates and displays.
 */

'use strict';

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 30_000;        // Clean up stale active-spin entries
const MAX_SPIN_AGE_MS = 60_000;            // A spin older than this is considered lost
const OPENSHOCK_BATCH_CLEANUP_THRESHOLD = 50;

const OPENSHOCK_MIN_INTENSITY = 1;
const OPENSHOCK_MAX_INTENSITY = 100;
const OPENSHOCK_MIN_DURATION_MS = 300;
const OPENSHOCK_MAX_DURATION_MS = 10_000;
const OPENSHOCK_DISPLAY_DELAY_MS = 500;    // Fire shock after result is visible

/** Outcome categories ordered from worst to best. */
const OUTCOME_CATEGORIES = ['loss', 'near_miss', 'small_win', 'medium_win', 'big_win', 'jackpot'];

// ────────────────────────────────────────────────────────────
// SlotGame class
// ────────────────────────────────────────────────────────────

class SlotGame {
  constructor(api, db, logger) {
    this.api = api;
    this.db = db;
    this.logger = logger;
    this.io = api.getSocketIO();
    this.unifiedQueue = null; // Set by main.js via setUnifiedQueue()

    // In-flight spins: spinId -> { username, nickname, machineId, timestamp, status }
    this.activeSpins = new Map();

    // Cooldown tracking: username -> lastSpinTimestamp (ms)
    this.userCooldowns = new Map();

    // Global cooldown tracking: machineId -> lastSpinTimestamp (ms)
    this.globalCooldowns = new Map();

    // Spin ID counter
    this.spinIdCounter = 0;

    // OpenShock deduplication
    this.openshockBatches = new Map();
    this.openshockBatchWindow = 5_000;

    // Cleanup timer handle
    this.cleanupTimer = null;
  }

  // ────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────

  init() {
    this.logger.info('🎰 Slot Machine game initialized');
  }

  setUnifiedQueue(unifiedQueue) {
    this.unifiedQueue = unifiedQueue;
  }

  startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this._cleanupStaleSpins(), CLEANUP_INTERVAL_MS);
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.activeSpins.clear();
    this.userCooldowns.clear();
    this.globalCooldowns.clear();
    this.openshockBatches.clear();
    this.logger.info('🎰 Slot Machine game destroyed');
  }

  // ────────────────────────────────────────────────────────
  // Public accessors
  // ────────────────────────────────────────────────────────

  getAllMachines() {
    return this.db.getAllSlotMachines();
  }

  getConfig(machineId = null) {
    return this.db.getSlotConfig(machineId);
  }

  createMachine(name, symbols = null, settings = null) {
    const defaultSymbols = symbols || this._defaultSymbols();
    const defaultSettings = settings || this._defaultSettings();
    const id = this.db.createSlotMachine(
      name,
      defaultSymbols,
      defaultSettings,
      {},
      this._defaultOddsProfiles(),
      this._defaultRewardRules()
    );
    this.logger.info(`🎰 Created new slot machine: "${name}" (ID: ${id})`);
    return id;
  }

  updateConfig(machineId, symbols, settings, giftMappings, oddsProfiles, rewardRules) {
    this.db.updateSlotConfig(machineId, symbols, settings, giftMappings, oddsProfiles, rewardRules);
    this.io.emit('slot:config-updated', {
      machineId,
      symbols,
      settings,
      giftMappings,
      oddsProfiles,
      rewardRules,
      timestamp: Date.now()
    });
    this.logger.info(`✅ Slot machine config updated (ID: ${machineId})`);
  }

  updateMachineName(machineId, name) {
    this.db.updateSlotName(machineId, name);
    this.logger.info(`✅ Slot machine name updated: "${name}" (ID: ${machineId})`);
  }

  updateMachineChatCommand(machineId, chatCommand) {
    this.db.updateSlotChatCommand(machineId, chatCommand);
    this.logger.info(`✅ Slot machine chat command updated: ${chatCommand || 'disabled'} (ID: ${machineId})`);
  }

  updateMachineEnabled(machineId, enabled) {
    this.db.updateSlotEnabled(machineId, enabled);
    this.logger.info(`✅ Slot machine ${enabled ? 'enabled' : 'disabled'} (ID: ${machineId})`);
  }

  deleteMachine(machineId) {
    const ok = this.db.deleteSlotMachine(machineId);
    if (ok) this.logger.info(`✅ Slot machine deleted (ID: ${machineId})`);
    return ok;
  }

  findMachineByGiftTrigger(giftIdentifier) {
    return this.db.findSlotMachineByGiftTrigger(giftIdentifier);
  }

  findMachineByChatCommand(command) {
    return this.db.findSlotMachineByChatCommand(command);
  }

  getStats(machineId) {
    return this.db.getSlotStats(machineId);
  }

  // ────────────────────────────────────────────────────────
  // Spin trigger entry points (called from main.js)
  // ────────────────────────────────────────────────────────

  /**
   * Trigger a slot spin from a chat command.
   *
   * @param {string} username
   * @param {string} nickname
   * @param {string} profilePictureUrl
   * @param {string} commandText – the full original command (e.g. "!spin")
   * @param {number|null} machineId – optional, defaults to first machine
   * @returns {Object} { success, error?, spinId?, queued? }
   */
  async triggerSpinFromChat(username, nickname, profilePictureUrl, commandText, machineId = null) {
    return this._triggerSpin(username, nickname, profilePictureUrl, 'chat', commandText, machineId, 'chat');
  }

  /**
   * Trigger a slot spin from a gift event.
   *
   * @param {string} username
   * @param {string} nickname
   * @param {string} profilePictureUrl
   * @param {string} giftName
   * @param {string|null} oddsProfileOverride – optional profile name from gift mapping
   * @param {number|null} machineId
   * @returns {Object} { success, error?, spinId?, queued? }
   */
  async triggerSpinFromGift(username, nickname, profilePictureUrl, giftName, oddsProfileOverride = null, machineId = null) {
    return this._triggerSpin(username, nickname, profilePictureUrl, 'gift', giftName, machineId, oddsProfileOverride || 'gift_common');
  }

  // ────────────────────────────────────────────────────────
  // Core spin logic
  // ────────────────────────────────────────────────────────

  /**
   * @private
   * Central spin method – validates cooldown, resolves outcome, dispatches rewards.
   */
  async _triggerSpin(username, nickname, profilePictureUrl, triggerType, triggerValue, machineId, oddsProfileKey) {
    const config = this.db.getSlotConfig(machineId);
    if (!config) {
      return { success: false, error: 'No slot machine configured' };
    }
    if (!config.enabled) {
      return { success: false, error: 'Slot machine is disabled' };
    }

    const resolvedMachineId = config.id;
    const settings = config.settings || {};

    // ── Cooldown check (chat triggers only) ──────────────────
    if (triggerType === 'chat') {
      const cooldownResult = this._checkCooldown(username, resolvedMachineId, settings);
      if (!cooldownResult.allowed) {
        this.io.emit('slot:cooldown', {
          username,
          nickname,
          remainingMs: cooldownResult.remainingMs,
          machineId: resolvedMachineId
        });
        return { success: false, error: `Cooldown: ${Math.ceil(cooldownResult.remainingMs / 1000)}s remaining` };
      }
      // Register cooldown immediately to prevent rapid fire
      this._registerCooldown(username, resolvedMachineId, settings);
    }

    // ── Global cooldown check (all trigger types) ─────────────
    if (settings.globalCooldownMs > 0) {
      const lastGlobal = this.globalCooldowns.get(resolvedMachineId) || 0;
      const elapsed = Date.now() - lastGlobal;
      if (elapsed < settings.globalCooldownMs) {
        return { success: false, error: `Global cooldown active (${Math.ceil((settings.globalCooldownMs - elapsed) / 1000)}s)` };
      }
      this.globalCooldowns.set(resolvedMachineId, Date.now());
    }

    // ── Assign spin ID and track ─────────────────────────────
    const spinId = ++this.spinIdCounter;
    const spinData = {
      spinId,
      username,
      nickname,
      profilePictureUrl: profilePictureUrl || '',
      machineId: resolvedMachineId,
      triggerType,
      triggerValue,
      timestamp: Date.now(),
      status: 'spinning'
    };
    this.activeSpins.set(spinId, spinData);

    // ── Notify overlay: spin started ─────────────────────────
    this.io.emit('slot:spin-started', {
      spinId,
      username,
      nickname,
      profilePictureUrl: profilePictureUrl || '',
      machineId: resolvedMachineId,
      machineName: config.name,
      symbols: config.symbols,
      settings
    });

    try {
      // ── Resolve outcome (server-authoritative) ────────────────
      const outcome = this._resolveOutcome(config, oddsProfileKey);

      // ── Persist spin record ───────────────────────────────────
      const rewardActions = this._buildRewardActions(outcome, config);
      this.db.recordSlotSpin({
        machineId: resolvedMachineId,
        username,
        nickname,
        triggerType,
        triggerValue,
        reel1: outcome.reels[0].id,
        reel2: outcome.reels[1].id,
        reel3: outcome.reels[2].id,
        outcomeCategory: outcome.category,
        rewardActions
      });

      // ── Emit result to overlay ────────────────────────────────
      this.io.emit('slot:spin-result', {
        spinId,
        username,
        nickname,
        profilePictureUrl: profilePictureUrl || '',
        machineId: resolvedMachineId,
        machineName: config.name,
        reels: outcome.reels,
        category: outcome.category,
        isWin: outcome.isWin,
        isJackpot: outcome.category === 'jackpot',
        isNearMiss: outcome.category === 'near_miss',
        rewardActions,
        settings
      });

      // ── Dispatch rewards ──────────────────────────────────────
      await this._dispatchRewards(rewardActions, spinData, outcome, config);

      spinData.status = 'completed';

      this.logger.info(
        `🎰 [SLOT] Spin #${spinId} for ${nickname} → ${outcome.reels.map(s => s.emoji).join(' ')} (${outcome.category})`
      );

      return { success: true, spinId, category: outcome.category, isWin: outcome.isWin };

    } catch (error) {
      this.logger.error(`[SLOT] Error during spin #${spinId} for ${username}: ${error.message}`);
      spinData.status = 'error';
      return { success: false, error: error.message };
    } finally {
      // Clean up the active spin tracking entry after a short delay
      // (overlay needs time to read it via status events if required)
      setTimeout(() => this.activeSpins.delete(spinId), MAX_SPIN_AGE_MS);
    }
  }

  // ────────────────────────────────────────────────────────
  // Cooldown helpers
  // ────────────────────────────────────────────────────────

  /**
   * @private
   * Check if a user is allowed to spin right now.
   * @returns {{ allowed: boolean, remainingMs: number }}
   */
  _checkCooldown(username, machineId, settings) {
    const now = Date.now();
    const key = `${machineId}:${username}`;
    const last = this.userCooldowns.get(key) || 0;
    const elapsed = now - last;

    // Determine effective cooldown length
    // (VIP/sub shortcuts can be implemented by the caller passing a role-adjusted config)
    const cdMs = settings.chatCooldownMs || 30_000;

    if (elapsed < cdMs) {
      return { allowed: false, remainingMs: cdMs - elapsed };
    }
    return { allowed: true, remainingMs: 0 };
  }

  /** @private */
  _registerCooldown(username, machineId, settings) {
    const key = `${machineId}:${username}`;
    this.userCooldowns.set(key, Date.now());
  }

  /**
   * Get remaining cooldown for a user (in ms, 0 if none)
   * @param {string} username
   * @param {number} machineId
   * @returns {number}
   */
  getUserCooldownRemaining(username, machineId) {
    const config = this.db.getSlotConfig(machineId);
    if (!config) return 0;
    const settings = config.settings || {};
    const check = this._checkCooldown(username, machineId, settings);
    return check.allowed ? 0 : check.remainingMs;
  }

  // ────────────────────────────────────────────────────────
  // Slot engine / RNG
  // ────────────────────────────────────────────────────────

  /**
   * @private
   * Resolve the outcome of a spin server-side.
   *
   * Flow:
   *   1. Choose an outcome category according to the odds profile.
   *   2. Build three reels consistent with that category.
   *   3. Return the full outcome descriptor.
   *
   * @param {Object} config       – slot machine config
   * @param {string} profileKey   – key inside config.oddsProfiles (e.g. 'chat')
   * @returns {Object} outcome
   */
  _resolveOutcome(config, profileKey) {
    const symbols = config.symbols;
    if (!symbols || symbols.length === 0) {
      throw new Error('No symbols configured for slot machine');
    }

    // Determine odds profile to use
    const profiles = config.oddsProfiles || {};
    const profile = profiles[profileKey] || profiles['chat'] || this._defaultOddsProfiles().chat;

    // Choose outcome category via weighted random
    const category = this._weightedChoice(profile);

    // Build reels consistent with the chosen category
    const reels = this._buildReels(symbols, category, config);

    const isWin = category !== 'loss' && category !== 'near_miss';

    return { category, reels, isWin };
  }

  /**
   * @private
   * Weighted random selection from an object of { key: weight }.
   */
  _weightedChoice(weightMap) {
    const entries = Object.entries(weightMap);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let rand = Math.random() * total;
    for (const [key, weight] of entries) {
      rand -= weight;
      if (rand <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * @private
   * Pick a random symbol from the symbol list using per-symbol weights.
   */
  _randomSymbol(symbols) {
    const total = symbols.reduce((s, sym) => s + (sym.weight || 1), 0);
    let rand = Math.random() * total;
    for (const sym of symbols) {
      rand -= sym.weight || 1;
      if (rand <= 0) return sym;
    }
    return symbols[symbols.length - 1];
  }

  /**
   * @private
   * Build three reel symbols that satisfy the requested outcome category.
   *
   * Category semantics:
   *   loss       – all three reels differ and no pair
   *   near_miss  – exactly two reels match (partial win)
   *   small_win  – three-of-a-kind with a low-tier symbol
   *   medium_win – three-of-a-kind with a mid-tier symbol
   *   big_win    – three-of-a-kind with a high-tier symbol
   *   jackpot    – three-of-a-kind with the rarest symbol
   *
   * Symbol tiers are derived from their position in the symbol array
   * (earlier = more common, later = rarer).
   */
  _buildReels(symbols, category, config) {
    const n = symbols.length;

    switch (category) {
      case 'loss': {
        // Pick three distinct symbols (no pair)
        let r1 = this._randomSymbol(symbols);
        let r2, r3;
        let attempts = 0;
        do {
          r2 = this._randomSymbol(symbols);
          attempts++;
        } while (r2.id === r1.id && attempts < 20);

        attempts = 0;
        do {
          r3 = this._randomSymbol(symbols);
          attempts++;
        } while ((r3.id === r1.id || r3.id === r2.id) && attempts < 20);

        return [r1, r2, r3];
      }

      case 'near_miss': {
        // Exactly two reels match
        const match = this._randomSymbol(symbols);
        let other;
        let attempts = 0;
        do {
          other = this._randomSymbol(symbols);
          attempts++;
        } while (other.id === match.id && attempts < 20);

        // Randomize which reel is the odd one out
        const pos = Math.floor(Math.random() * 3);
        const reels = [match, match, match];
        reels[pos] = other;
        return reels;
      }

      case 'small_win': {
        // 3-of-a-kind from the first third of the symbol list (common symbols)
        const pool = symbols.slice(0, Math.max(1, Math.ceil(n * 0.45)));
        const sym = pool[Math.floor(Math.random() * pool.length)];
        return [sym, sym, sym];
      }

      case 'medium_win': {
        // 3-of-a-kind from the middle third
        const start = Math.floor(n * 0.35);
        const end = Math.floor(n * 0.70);
        const pool = symbols.slice(start, Math.max(start + 1, end));
        const sym = pool[Math.floor(Math.random() * pool.length)];
        return [sym, sym, sym];
      }

      case 'big_win': {
        // 3-of-a-kind from the upper quarter
        const start = Math.floor(n * 0.65);
        const pool = symbols.slice(start, Math.max(start + 1, n - 1));
        const sym = pool[Math.floor(Math.random() * pool.length)];
        return [sym, sym, sym];
      }

      case 'jackpot': {
        // 3-of-a-kind with the last (rarest) symbol
        const sym = symbols[n - 1];
        return [sym, sym, sym];
      }

      default:
        // Fallback: pure random
        return [this._randomSymbol(symbols), this._randomSymbol(symbols), this._randomSymbol(symbols)];
    }
  }

  // ────────────────────────────────────────────────────────
  // Reward dispatch
  // ────────────────────────────────────────────────────────

  /**
   * @private
   * Build the list of reward actions to execute for this outcome.
   */
  _buildRewardActions(outcome, config) {
    const rules = config.rewardRules || [];
    const actions = [];

    for (const rule of rules) {
      if (!rule.outcomeCategories || !rule.outcomeCategories.includes(outcome.category)) continue;
      actions.push({ action: rule.action, params: rule.params || {} });
    }

    return actions;
  }

  /**
   * @private
   * Execute all reward actions for a spin.
   */
  async _dispatchRewards(rewardActions, spinData, outcome, config) {
    for (const reward of rewardActions) {
      try {
        await this._executeReward(reward, spinData, outcome, config);
      } catch (error) {
        this.logger.error(`[SLOT] Reward dispatch error (action: ${reward.action}): ${error.message}`);
      }
    }
  }

  /**
   * @private
   * Execute a single reward action.
   *
   * Supported action types:
   *   audio      – emit slot:play-audio socket event (overlay handles playback)
   *   overlay    – emit slot:overlay-effect socket event
   *   openshock  – trigger OpenShock haptic feedback
   *   xp         – grant XP via viewer-leaderboard plugin
   *   chat       – send a chat-message socket event (chatbot picks it up)
   *   free_spin  – grant a free spin (emit event, no cooldown deducted)
   */
  async _executeReward(reward, spinData, outcome, config) {
    const { action, params } = reward;

    switch (action) {
      case 'audio':
        this.io.emit('slot:play-audio', {
          machineId: spinData.machineId,
          audioType: params.audioType || 'win',
          username: spinData.username,
          category: outcome.category
        });
        break;

      case 'overlay':
        this.io.emit('slot:overlay-effect', {
          machineId: spinData.machineId,
          effect: params.effect || 'win',
          username: spinData.username,
          nickname: spinData.nickname,
          category: outcome.category,
          reels: outcome.reels
        });
        break;

      case 'openshock':
        await this._triggerOpenshock(params, spinData, outcome, config);
        break;

      case 'xp': {
        const xpAmount = params.xp || 0;
        if (xpAmount <= 0) break;
        try {
          const vlPlugin = this.api.pluginLoader?.loadedPlugins?.get('viewer-leaderboard');
          if (vlPlugin?.instance?.db) {
            vlPlugin.instance.db.addXP(
              spinData.username,
              xpAmount,
              'slot_win',
              { category: outcome.category, machineId: spinData.machineId }
            );
            this.logger.info(`🎰 Awarded ${xpAmount} XP to ${spinData.nickname} (slot ${outcome.category})`);
          }
        } catch (error) {
          this.logger.warn(`[SLOT] XP reward failed: ${error.message}`);
        }
        break;
      }

      case 'chat':
        this.io.emit('slot:chat-message', {
          machineId: spinData.machineId,
          username: spinData.username,
          nickname: spinData.nickname,
          message: (params.message || '')
            .replace('{username}', spinData.nickname)
            .replace('{category}', outcome.category)
            .replace('{reels}', outcome.reels.map(s => s.emoji).join(' ')),
          category: outcome.category
        });
        break;

      case 'free_spin':
        this.io.emit('slot:free-spin-granted', {
          machineId: spinData.machineId,
          username: spinData.username,
          nickname: spinData.nickname,
          count: params.count || 1
        });
        break;

      default:
        this.logger.warn(`[SLOT] Unknown reward action: ${action}`);
    }
  }

  // ────────────────────────────────────────────────────────
  // OpenShock integration
  // ────────────────────────────────────────────────────────

  /**
   * @private
   * Trigger OpenShock haptic feedback with deduplication and safety clamping.
   */
  async _triggerOpenshock(params, spinData, outcome, config) {
    const intensity = Math.max(OPENSHOCK_MIN_INTENSITY, Math.min(OPENSHOCK_MAX_INTENSITY, params.intensity || 50));
    const duration  = Math.max(OPENSHOCK_MIN_DURATION_MS, Math.min(OPENSHOCK_MAX_DURATION_MS, params.duration || 1000));
    const actionType = (params.shockType || 'shock').toLowerCase();

    const openShockPlugin = this.api.pluginLoader?.loadedPlugins?.get('openshock');
    if (!openShockPlugin?.instance) {
      this.logger.warn('[SLOT] OpenShock plugin not available');
      return;
    }

    const availableDevices = openShockPlugin.instance.devices || [];
    if (availableDevices.length === 0) {
      this.logger.warn('[SLOT] No OpenShock devices available');
      return;
    }

    // Determine target devices
    let targetDevices = [];
    if (params.shockDevices && params.shockDevices.length > 0) {
      targetDevices = params.shockDevices
        .map(id => availableDevices.find(d => d.id === id))
        .filter(Boolean);
    }
    if (targetDevices.length === 0) {
      targetDevices = [availableDevices[0]];
    }

    // Deduplication
    const batchKey = this._getOpenshockBatchKey(spinData.username, targetDevices.map(d => d.id), actionType, intensity, duration);
    if (this._isDuplicateOpenshockBatch(batchKey)) {
      this.logger.info(`[SLOT] Duplicate OpenShock batch blocked for ${spinData.username}`);
      return;
    }

    // Fire after display delay
    const logger = this.logger;
    setTimeout(() => {
      (async () => {
        try {
          const plugin = this.api.pluginLoader?.loadedPlugins?.get('openshock');
          if (!plugin?.instance) return;

          for (const device of targetDevices) {
            try {
              const metadata = {
                priority: 2,
                source: 'slot',
                metadata: {
                  username: spinData.username,
                  nickname: spinData.nickname,
                  category: outcome.category,
                  machineId: spinData.machineId,
                  spinId: spinData.spinId
                }
              };
              if (actionType === 'vibrate') {
                await plugin.instance.openShockClient.sendVibrate(device.id, intensity, duration, metadata);
              } else {
                await plugin.instance.openShockClient.sendShock(device.id, intensity, duration, metadata);
              }
            } catch (err) {
              logger.error(`[SLOT] OpenShock command failed for device ${device.name}: ${err.message}`);
            }
          }

          this.io.emit('slot:shock-triggered', {
            spinId: spinData.spinId,
            username: spinData.username,
            nickname: spinData.nickname,
            actionType,
            intensity,
            duration,
            machineId: spinData.machineId,
            deviceCount: targetDevices.length
          });
        } catch (err) {
          logger.error(`[SLOT] OpenShock dispatch error: ${err.message}`);
        }
      })();
    }, OPENSHOCK_DISPLAY_DELAY_MS);
  }

  /** @private */
  _getOpenshockBatchKey(username, deviceIds, type, intensity, duration) {
    return `${username}:${deviceIds.sort().join(',')}:${type}:${intensity}:${duration}`;
  }

  /** @private */
  _isDuplicateOpenshockBatch(key) {
    const now = Date.now();
    this._cleanupOpenshockBatches();
    const last = this.openshockBatches.get(key);
    if (last && (now - last) < this.openshockBatchWindow) return true;
    this.openshockBatches.set(key, now);
    return false;
  }

  /** @private */
  _cleanupOpenshockBatches() {
    if (this.openshockBatches.size < OPENSHOCK_BATCH_CLEANUP_THRESHOLD) return;
    const now = Date.now();
    for (const [key, ts] of this.openshockBatches.entries()) {
      if ((now - ts) > this.openshockBatchWindow) {
        this.openshockBatches.delete(key);
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // Stale spin cleanup
  // ────────────────────────────────────────────────────────

  /** @private */
  _cleanupStaleSpins() {
    const now = Date.now();
    for (const [spinId, spinData] of this.activeSpins.entries()) {
      if ((now - spinData.timestamp) > MAX_SPIN_AGE_MS) {
        this.logger.warn(`[SLOT] Cleaning up stale spin #${spinId} for ${spinData.username}`);
        this.activeSpins.delete(spinId);
      }
    }

    // Also purge very old cooldown entries to prevent memory growth
    if (this.userCooldowns.size > 1000) {
      const cutoff = now - 3_600_000; // 1 hour
      for (const [key, ts] of this.userCooldowns.entries()) {
        if (ts < cutoff) this.userCooldowns.delete(key);
      }
    }
  }

  // ────────────────────────────────────────────────────────
  // Default configuration values
  // ────────────────────────────────────────────────────────

  /** @private */
  _defaultSymbols() {
    return [
      { id: 'cherry',  emoji: '🍒', label: 'Cherry',  weight: 18 },
      { id: 'lemon',   emoji: '🍋', label: 'Lemon',   weight: 16 },
      { id: 'grape',   emoji: '🍇', label: 'Grape',   weight: 14 },
      { id: 'clover',  emoji: '🍀', label: 'Clover',  weight: 12 },
      { id: 'star',    emoji: '⭐',  label: 'Star',    weight: 10 },
      { id: 'bell',    emoji: '🔔', label: 'Bell',    weight:  8 },
      { id: 'diamond', emoji: '💎', label: 'Diamond', weight:  6 },
      { id: 'money',   emoji: '💰', label: 'Money',   weight:  5 },
      { id: 'seven',   emoji: '7️⃣',  label: 'Seven',  weight:  4 },
      { id: 'bolt',    emoji: '⚡',  label: 'Bolt',   weight:  4 },
      { id: 'fire',    emoji: '🔥', label: 'Fire',   weight:  2 },
      { id: 'joker',   emoji: '🃏', label: 'Joker',  weight:  1 }
    ];
  }

  /** @private */
  _defaultSettings() {
    return {
      spinDuration: 3000,
      reelStopDelay: 400,
      soundEnabled: true,
      soundVolume: 0.7,
      chatCooldownMs: 30000,
      globalCooldownMs: 0,
      vipCooldownMs: 15000,
      subCooldownMs: 10000,
      nearMissEnabled: true,
      showResultDuration: 5000
    };
  }

  /** @private */
  _defaultOddsProfiles() {
    return {
      chat: {
        loss:       650,
        near_miss:   80,
        small_win:  150,
        medium_win:  70,
        big_win:     40,
        jackpot:     10
      },
      gift_common: {
        loss:       550,
        near_miss:   80,
        small_win:  200,
        medium_win:  90,
        big_win:     60,
        jackpot:     20
      },
      gift_rare: {
        loss:       400,
        near_miss:   70,
        small_win:  230,
        medium_win: 130,
        big_win:    110,
        jackpot:     60
      }
    };
  }

  /** @private */
  _defaultRewardRules() {
    return [
      {
        id: 'small_win_audio',
        outcomeCategories: ['small_win'],
        action: 'audio',
        params: { audioType: 'small_win' }
      },
      {
        id: 'medium_win_audio',
        outcomeCategories: ['medium_win'],
        action: 'audio',
        params: { audioType: 'medium_win' }
      },
      {
        id: 'big_win_audio',
        outcomeCategories: ['big_win'],
        action: 'audio',
        params: { audioType: 'big_win' }
      },
      {
        id: 'jackpot_audio',
        outcomeCategories: ['jackpot'],
        action: 'audio',
        params: { audioType: 'jackpot' }
      }
    ];
  }
}

module.exports = SlotGame;
