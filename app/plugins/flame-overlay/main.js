/**
 * TikTok Flame Overlay Plugin
 * 
 * WebGL-based flame border overlay for TikTok livestreams
 * Features configurable colors, intensity, speed, and frame thickness
 * Optimized for OBS Browser Source with transparent background
 * v3.0.0: Interactive trigger system for TikTok LIVE events
 */

const path = require('path');

/**
 * Preset definitions for the trigger system
 */
const TRIGGER_PRESETS = {
  default: {
    triggerCooldown: 2000,
    triggerMaxStack: 5,
    triggerRules: [
      { id: 'gift-big', event: 'gift', condition: 'diamondCount >= 1000', action: 'dramatic', effect: 'lightning', duration: 10000, enabled: true },
      { id: 'gift-medium', event: 'gift', condition: 'diamondCount >= 100', action: 'intensity-boost', amount: 0.5, duration: 5000, enabled: true },
      { id: 'gift-small', event: 'gift', condition: 'any', action: 'flash', duration: 800, enabled: true },
      { id: 'follow', event: 'follow', condition: 'any', action: 'pulse', intensity: 0.3, duration: 1500, enabled: true },
      { id: 'like-burst', event: 'like', condition: 'likeCount >= 50', action: 'intensity-boost', amount: 0.4, duration: 3000, enabled: true },
      { id: 'share', event: 'share', condition: 'any', action: 'effect-switch', effect: 'particles', duration: 3000, enabled: true },
      { id: 'subscribe', event: 'subscribe', condition: 'any', action: 'color-flash', color: '#ffd700', duration: 5000, enabled: true },
      { id: 'chat-color', event: 'chat', condition: 'keyword-match', action: 'color-change', duration: 15000, enabled: true }
    ]
  },
  hype: {
    triggerCooldown: 500,
    triggerMaxStack: 10,
    triggerRules: [
      { id: 'gift-big', event: 'gift', condition: 'diamondCount >= 1000', action: 'dramatic', effect: 'lightning', duration: 8000, enabled: true },
      { id: 'gift-medium', event: 'gift', condition: 'diamondCount >= 100', action: 'intensity-boost', amount: 0.8, duration: 4000, enabled: true },
      { id: 'gift-small', event: 'gift', condition: 'any', action: 'flash', duration: 500, enabled: true },
      { id: 'follow', event: 'follow', condition: 'any', action: 'pulse', intensity: 0.5, duration: 1000, enabled: true },
      { id: 'like-burst', event: 'like', condition: 'likeCount >= 20', action: 'intensity-boost', amount: 0.6, duration: 2000, enabled: true },
      { id: 'share', event: 'share', condition: 'any', action: 'effect-switch', effect: 'particles', duration: 2000, enabled: true },
      { id: 'subscribe', event: 'subscribe', condition: 'any', action: 'color-flash', color: '#ffd700', duration: 4000, enabled: true },
      { id: 'chat-color', event: 'chat', condition: 'keyword-match', action: 'color-change', duration: 10000, enabled: true }
    ]
  },
  chill: {
    triggerCooldown: 5000,
    triggerMaxStack: 3,
    triggerRules: [
      { id: 'gift-big', event: 'gift', condition: 'diamondCount >= 1000', action: 'dramatic', effect: 'lightning', duration: 12000, enabled: true },
      { id: 'gift-medium', event: 'gift', condition: 'diamondCount >= 100', action: 'intensity-boost', amount: 0.2, duration: 6000, enabled: true },
      { id: 'gift-small', event: 'gift', condition: 'any', action: 'flash', duration: 1000, enabled: true },
      { id: 'follow', event: 'follow', condition: 'any', action: 'pulse', intensity: 0.2, duration: 2000, enabled: true },
      { id: 'like-burst', event: 'like', condition: 'likeCount >= 100', action: 'intensity-boost', amount: 0.2, duration: 4000, enabled: true },
      { id: 'share', event: 'share', condition: 'any', action: 'effect-switch', effect: 'particles', duration: 4000, enabled: true },
      { id: 'subscribe', event: 'subscribe', condition: 'any', action: 'color-flash', color: '#ffd700', duration: 6000, enabled: true },
      { id: 'chat-color', event: 'chat', condition: 'keyword-match', action: 'color-change', duration: 20000, enabled: true }
    ]
  },
  party: {
    triggerCooldown: 300,
    triggerMaxStack: 15,
    triggerRules: [
      { id: 'gift-big', event: 'gift', condition: 'diamondCount >= 500', action: 'dramatic', effect: 'lightning', duration: 8000, enabled: true },
      { id: 'gift-medium', event: 'gift', condition: 'diamondCount >= 50', action: 'intensity-boost', amount: 1.0, duration: 4000, enabled: true },
      { id: 'gift-small', event: 'gift', condition: 'any', action: 'color-flash', color: '#ff00ff', duration: 600, enabled: true },
      { id: 'follow', event: 'follow', condition: 'any', action: 'pulse', intensity: 0.6, duration: 1000, enabled: true },
      { id: 'like-burst', event: 'like', condition: 'likeCount >= 10', action: 'intensity-boost', amount: 0.7, duration: 2000, enabled: true },
      { id: 'share', event: 'share', condition: 'any', action: 'dramatic', effect: 'energy', duration: 3000, enabled: true },
      { id: 'subscribe', event: 'subscribe', condition: 'any', action: 'color-flash', color: '#ffd700', duration: 5000, enabled: true },
      { id: 'chat-color', event: 'chat', condition: 'keyword-match', action: 'color-change', duration: 12000, enabled: true }
    ]
  }
};

/** Color map for chat color commands */
const CHAT_COLOR_MAP = {
  '!red': '#ff0000',
  '!blue': '#0066ff',
  '!green': '#00ff00',
  '!purple': '#9900ff',
  '!pink': '#ff69b4',
  '!gold': '#ffd700',
  '!cyan': '#00ffff',
  '!orange': '#ff6600',
  '!white': '#ffffff'
};

class FlameOverlayPlugin {
    constructor(api) {
        this.api = api;
        this.config = null;
        this.lastTriggerTime = new Map();
        this.activeTriggerCount = 0;
        this.triggerLog = [];
    }

    async init() {
        this.api.log('🔥 [FLAME OVERLAY] Initializing TikTok Flame Overlay Plugin...', 'info');

        // Load configuration
        this.loadConfig();

        // Register routes
        this.registerRoutes();

        // Register TikTok event handlers if triggers are enabled
        if (this.config.triggersEnabled !== false) {
            this.registerTikTokEventHandlers();
        }

        this.api.log('✅ [FLAME OVERLAY] Plugin initialized successfully', 'info');
        this.logRoutes();
    }

    /**
     * Load plugin configuration from database or defaults
     */
    loadConfig() {
        const savedConfig = this.api.getConfig('settings');
        
        // Default configuration with all features
        const defaultConfig = {
            // Effect type selection
            effectType: 'flames', // 'flames', 'particles', 'energy', 'lightning'
            
            // Resolution settings
            resolutionPreset: 'tiktok-portrait',
            customWidth: 720,
            customHeight: 1280,
            
            // Frame settings
            frameMode: 'bottom', // 'bottom', 'top', 'sides', 'all'
            frameThickness: 150, // pixels
            
            // Frame positioning (for multiple frames in preview)
            framePositions: [
                { x: 0, y: 0, width: 100, height: 100 } // Default: full screen
            ],
            
            // Flame appearance
            flameColor: '#ff6600', // Main flame color
            backgroundTint: '#000000', // Background tint color
            backgroundTintOpacity: 0.0, // 0.0 = fully transparent
            
            // Flame animation
            flameSpeed: 0.5, // Time multiplier
            flameIntensity: 1.3, // Magnitude/turbulence
            flameBrightness: 0.25, // Overall brightness multiplier
            
            // Visual effects
            enableGlow: true,
            enableAdditiveBlend: true,
            
            // Advanced
            maskOnlyEdges: true, // Only show flames on frame edges
            highDPI: true, // Handle high DPI displays
            
            // ===== NEW FEATURES (v2.2.0) =====
            // Quality Settings
            noiseOctaves: 8, // 4-12 octaves for fBm
            useHighQualityTextures: false, // Enable when HQ textures are available
            detailScaleAuto: true, // Automatic detail scaling based on resolution
            
            // Edge Settings
            edgeFeather: 0.3, // 0.0-1.0: Soft edge blending amount
            frameCurve: 0.0, // 0.0-1.0: Curved frame edges (0=sharp corners)
            frameNoiseAmount: 0.0, // 0.0-1.0: Noise modulation on frame edges
            
            // Animation
            animationEasing: 'linear', // 'linear', 'sine', 'quad', 'elastic'
            pulseEnabled: false, // Enable pulsing/breathing animation
            pulseAmount: 0.2, // 0.0-1.0: Pulse intensity
            pulseSpeed: 1.0, // 0.1-3.0: Pulse frequency
            
            // Bloom
            bloomEnabled: false, // Enable bloom post-processing
            bloomIntensity: 0.8, // 0.0-2.0: Bloom strength
            bloomThreshold: 0.6, // 0.0-1.0: Brightness threshold for bloom
            bloomRadius: 4, // 1-10: Bloom blur radius
            
            // Layers
            layersEnabled: false, // Enable multi-layer compositing
            layerCount: 3, // 1-3: Number of layers
            layerParallax: 0.3, // 0.0-1.0: Parallax effect strength
            
            // Post-FX
            chromaticAberration: 0.005, // 0.0-0.02: RGB channel offset
            filmGrain: 0.03, // 0.0-0.1: Film grain intensity
            depthIntensity: 0.5, // 0.0-1.0: Fake depth/inner glow
            
            // Smoke
            smokeEnabled: false, // Enable smoke layer
            smokeIntensity: 0.4, // 0.0-1.0: Smoke opacity
            smokeSpeed: 0.3, // 0.1-1.0: Smoke movement speed
            smokeColor: '#333333', // Smoke color

            // ===== TRIGGER SYSTEM (v3.0.0) =====
            triggersEnabled: true,
            triggerRules: TRIGGER_PRESETS.default.triggerRules,
            chatColorCommands: true,
            triggerCooldown: 2000,
            triggerMaxStack: 5,
            triggerPreset: 'default'
        };
        
        // Merge saved config with defaults to ensure backward compatibility
        this.config = savedConfig ? { ...defaultConfig, ...savedConfig } : defaultConfig;
    }

    /**
     * Save plugin configuration to database
     */
    saveConfig() {
        this.api.setConfig('settings', this.config);
    }

    /**
     * Get resolution based on preset or custom values
     */
    getResolution() {
        const presets = {
            'tiktok-portrait': { width: 720, height: 1280 },
            'tiktok-landscape': { width: 1280, height: 720 },
            'hd-portrait': { width: 1080, height: 1920 },
            'hd-landscape': { width: 1920, height: 1080 },
            '2k-portrait': { width: 1440, height: 2560 },
            '2k-landscape': { width: 2560, height: 1440 },
            '4k-portrait': { width: 2160, height: 3840 },
            '4k-landscape': { width: 3840, height: 2160 },
            'custom': { width: this.config.customWidth, height: this.config.customHeight }
        };
        
        return presets[this.config.resolutionPreset] || presets['tiktok-portrait'];
    }

    /**
     * Register all HTTP routes
     */
    registerRoutes() {
        // Serve plugin UI (settings page)
        this.api.registerRoute('get', '/flame-overlay/ui', (req, res) => {
            const uiPath = path.join(__dirname, 'ui', 'settings.html');
            res.sendFile(uiPath);
        });

        // Serve overlay/renderer
        this.api.registerRoute('get', '/flame-overlay/overlay', (req, res) => {
            const overlayPath = path.join(__dirname, 'renderer', 'index.html');
            res.sendFile(overlayPath);
        });

        // Get configuration
        this.api.registerRoute('get', '/api/flame-overlay/config', (req, res) => {
            try {
                res.json({ success: true, config: this.config });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error getting config: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Update configuration
        this.api.registerRoute('post', '/api/flame-overlay/config', (req, res) => {
            try {
                const updates = req.body;
                this.config = { ...this.config, ...updates };
                this.saveConfig();
                
                // Notify overlays about config change
                this.api.emit('flame-overlay:config-update', { config: this.config });
                
                res.json({ success: true, message: 'Configuration updated' });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error updating config: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Get status
        this.api.registerRoute('get', '/api/flame-overlay/status', (req, res) => {
            try {
                const resolution = this.getResolution();
                res.json({
                    success: true,
                    config: this.config,
                    resolution: resolution
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Serve texture files
        const express = require('express');
        const textureDir = path.join(__dirname, 'textures');
        this.api.getApp().use('/plugins/flame-overlay/textures', express.static(textureDir));
        
        // Serve renderer directory for flame.js
        const rendererDir = path.join(__dirname, 'renderer');
        this.api.getApp().use('/flame-overlay', express.static(rendererDir));

        // --- Trigger API endpoints (v3.0.0) ---

        // Manual trigger endpoint (for testing / IFTTT / other plugins)
        this.api.registerRoute('post', '/api/flame-overlay/trigger', (req, res) => {
            try {
                const trigger = req.body;
                if (!trigger.type) {
                    return res.status(400).json({ success: false, error: 'Missing trigger type' });
                }
                this.dispatchTrigger(trigger);
                res.json({ success: true, message: 'Trigger sent' });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Trigger error: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Get trigger rules
        this.api.registerRoute('get', '/api/flame-overlay/triggers', (req, res) => {
            try {
                res.json({ success: true, rules: this.config.triggerRules || [] });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Save trigger rules
        this.api.registerRoute('post', '/api/flame-overlay/triggers', (req, res) => {
            try {
                const { rules } = req.body;
                if (!Array.isArray(rules)) {
                    return res.status(400).json({ success: false, error: 'rules must be an array' });
                }
                this.config.triggerRules = rules;
                this.config.triggerPreset = 'custom';
                this.saveConfig();
                res.json({ success: true, message: 'Trigger rules saved' });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error saving triggers: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Get available presets
        this.api.registerRoute('get', '/api/flame-overlay/trigger-presets', (req, res) => {
            try {
                const presetNames = Object.keys(TRIGGER_PRESETS);
                res.json({ success: true, presets: presetNames, current: this.config.triggerPreset || 'default' });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Activate a preset
        this.api.registerRoute('post', '/api/flame-overlay/trigger-preset/:name', (req, res) => {
            try {
                const { name } = req.params;
                if (!TRIGGER_PRESETS[name]) {
                    return res.status(400).json({ success: false, error: `Unknown preset: ${name}` });
                }
                const preset = TRIGGER_PRESETS[name];
                this.config.triggerRules = preset.triggerRules;
                this.config.triggerCooldown = preset.triggerCooldown;
                this.config.triggerMaxStack = preset.triggerMaxStack;
                this.config.triggerPreset = name;
                this.saveConfig();
                this.api.log(`🎮 [FLAME OVERLAY] Preset '${name}' activated`, 'info');
                res.json({ success: true, message: `Preset '${name}' activated`, config: this.config });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error activating preset: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }

    /**
     * Register TikTok event handlers for interactive triggers
     */
    registerTikTokEventHandlers() {
        this.api.registerTikTokEvent('gift', (data) => {
            this.handleGiftTrigger(data);
        });

        this.api.registerTikTokEvent('follow', (data) => {
            this.evaluateTriggerRules('follow', data);
        });

        this.api.registerTikTokEvent('like', (data) => {
            this.evaluateTriggerRules('like', data);
        });

        this.api.registerTikTokEvent('share', (data) => {
            this.evaluateTriggerRules('share', data);
        });

        this.api.registerTikTokEvent('chat', (data) => {
            if (this.config.chatColorCommands !== false) {
                this.handleChatCommand(data);
            }
            this.evaluateTriggerRules('chat', data);
        });

        this.api.registerTikTokEvent('subscribe', (data) => {
            this.evaluateTriggerRules('subscribe', data);
        });

        this.api.log('🎮 [FLAME OVERLAY] TikTok event handlers registered', 'info');
    }

    /**
     * Handle gift triggers with diamond count tiers
     * @param {object} data - TikTok gift event data
     */
    handleGiftTrigger(data) {
        const diamondCount = data.diamondCount || data.giftValue || 1;

        if (diamondCount >= 1000) {
            this.dispatchTrigger({
                type: 'dramatic',
                effect: 'lightning',
                duration: 10000,
                intensityBoost: 1.0,
                bloomOverride: { enabled: true, intensity: 1.5 },
                revert: true,
                source: `gift:${diamondCount}`
            });
        } else if (diamondCount >= 100) {
            this.dispatchTrigger({
                type: 'intensity-boost',
                amount: 0.5,
                duration: 5000,
                revert: true,
                source: `gift:${diamondCount}`
            });
        } else {
            this.dispatchTrigger({
                type: 'flash',
                duration: 800,
                revert: true,
                source: `gift:${diamondCount}`
            });
        }
    }

    /**
     * Handle chat color commands (!red, !blue, etc.)
     * @param {object} data - TikTok chat event data
     */
    handleChatCommand(data) {
        const msg = ((data.comment || data.message || '')).toLowerCase().trim();
        const color = CHAT_COLOR_MAP[msg];

        if (color) {
            this.dispatchTrigger({
                type: 'color-change',
                color,
                duration: 15000,
                revert: true,
                source: `chat:${msg}`
            });
        }
    }

    /**
     * Evaluate configured trigger rules for a given event
     * @param {string} event - TikTok event type
     * @param {object} data - Event data
     */
    evaluateTriggerRules(event, data) {
        const rules = (this.config.triggerRules || []).filter(r => r.enabled && r.event === event);

        for (const rule of rules) {
            if (this.evaluateCondition(rule.condition, data)) {
                const trigger = {
                    type: rule.action,
                    duration: rule.duration,
                    revert: true,
                    source: `rule:${rule.id}`
                };

                if (rule.effect !== undefined) trigger.effect = rule.effect;
                if (rule.amount !== undefined) trigger.amount = rule.amount;
                if (rule.intensity !== undefined) trigger.intensity = rule.intensity;
                if (rule.color !== undefined) trigger.color = rule.color;
                if (rule.intensityBoost !== undefined) trigger.intensityBoost = rule.intensityBoost;

                // Chat color-change rules are handled by handleChatCommand
                if (event === 'chat' && rule.action === 'color-change') {
                    continue;
                }

                this.dispatchTrigger(trigger);
                break; // Only first matching rule fires per event
            }
        }
    }

    /**
     * Evaluate a condition string against event data
     * @param {string} condition - Condition string ('any', 'diamondCount >= 1000', etc.)
     * @param {object} data - Event data
     * @returns {boolean}
     */
    evaluateCondition(condition, data) {
        if (!condition || condition === 'any') return true;
        if (condition === 'keyword-match') return false; // handled separately

        try {
            const match = condition.match(/^(\w+)\s*(>=|<=|>|<|===?|!==?)\s*(\d+(?:\.\d+)?)$/);
            if (match) {
                const [, field, op, valueStr] = match;
                const fieldValue = Number(data[field]) || 0;
                const threshold = parseFloat(valueStr);

                switch (op) {
                    case '>=': return fieldValue >= threshold;
                    case '<=': return fieldValue <= threshold;
                    case '>':  return fieldValue > threshold;
                    case '<':  return fieldValue < threshold;
                    case '==':
                    case '===': return fieldValue === threshold;
                    case '!=':
                    case '!==': return fieldValue !== threshold;
                }
            }
        } catch (e) {
            this.api.log(`⚠️ [FLAME OVERLAY] Invalid condition: ${condition}`, 'warn');
        }

        return false;
    }

    /**
     * Dispatch a trigger with cooldown and stack limit checks
     * @param {object} trigger - Trigger object
     */
    dispatchTrigger(trigger) {
        if (this.config.triggersEnabled === false) return;

        const eventKey = trigger.source ? trigger.source.split(':')[0] : trigger.type;
        const now = Date.now();
        const cooldown = this.config.triggerCooldown != null ? this.config.triggerCooldown : 2000;
        const maxStack = this.config.triggerMaxStack != null ? this.config.triggerMaxStack : 5;

        // Cooldown check
        const lastTime = this.lastTriggerTime.get(eventKey) || 0;
        if (now - lastTime < cooldown) return;

        // Stack limit check
        if (this.activeTriggerCount >= maxStack) return;

        this.lastTriggerTime.set(eventKey, now);
        this.activeTriggerCount++;

        const triggerId = `${now}-${Math.random().toString(36).substr(2, 6)}`;
        const triggerWithId = { ...trigger, id: triggerId };

        this.api.emit('flame-overlay:trigger', triggerWithId);

        // Track trigger in log (keep last 10)
        this.triggerLog.unshift({ id: triggerId, type: trigger.type, source: trigger.source || 'manual', time: now });
        if (this.triggerLog.length > 10) this.triggerLog.pop();

        // Emit status update for UI
        this.api.emit('flame-overlay:trigger-status', {
            activeTriggers: this.activeTriggerCount,
            recentTriggers: this.triggerLog.slice(0, 5)
        });

        // Auto-decrement active count after duration
        if (trigger.duration) {
            setTimeout(() => {
                this.activeTriggerCount = Math.max(0, this.activeTriggerCount - 1);
                this.api.emit('flame-overlay:trigger-status', {
                    activeTriggers: this.activeTriggerCount,
                    recentTriggers: this.triggerLog.slice(0, 5)
                });
            }, trigger.duration);
        } else {
            setTimeout(() => {
                this.activeTriggerCount = Math.max(0, this.activeTriggerCount - 1);
            }, 100);
        }
    }

    /**
     * Log registered routes
     */
    logRoutes() {
        this.api.log('📍 [FLAME OVERLAY] Routes registered:', 'info');
        this.api.log('   - GET  /flame-overlay/ui', 'info');
        this.api.log('   - GET  /flame-overlay/overlay', 'info');
        this.api.log('   - GET  /api/flame-overlay/config', 'info');
        this.api.log('   - POST /api/flame-overlay/config', 'info');
        this.api.log('   - GET  /api/flame-overlay/status', 'info');
        this.api.log('   - POST /api/flame-overlay/trigger', 'info');
        this.api.log('   - GET  /api/flame-overlay/triggers', 'info');
        this.api.log('   - POST /api/flame-overlay/triggers', 'info');
        this.api.log('   - GET  /api/flame-overlay/trigger-presets', 'info');
        this.api.log('   - POST /api/flame-overlay/trigger-preset/:name', 'info');
    }

    /**
     * Cleanup on plugin destroy
     */
    async destroy() {
        this.api.log('🔥 [FLAME OVERLAY] Plugin destroyed', 'info');
    }
}

module.exports = FlameOverlayPlugin;
