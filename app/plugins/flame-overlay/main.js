/**
 * TikTok Flame Overlay Plugin
 * 
 * WebGL-based flame border overlay for TikTok livestreams
 * Features configurable colors, intensity, speed, and frame thickness
 * Optimized for OBS Browser Source with transparent background
 */

const path = require('path');

class FlameOverlayPlugin {
    constructor(api) {
        this.api = api;
        this.config = null;
    }

    async init() {
        this.api.log('🔥 [FLAME OVERLAY] Initializing TikTok Flame Overlay Plugin...', 'info');

        // Load configuration
        this.loadConfig();

        // Register routes
        this.registerRoutes();

        // Register TikTok event handlers
        this.registerTikTokEventHandlers();

        // Register flow actions
        this.registerFlowActions();

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
            smokeColor: '#333333' // Smoke color
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

        // GET /api/flame-overlay/presets - Load all presets
        this.api.registerRoute('get', '/api/flame-overlay/presets', (req, res) => {
            try {
                const presets = this.api.getConfig('presets') || {};
                res.json({ success: true, presets });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error loading presets: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // POST /api/flame-overlay/presets/:name - Save preset
        this.api.registerRoute('post', '/api/flame-overlay/presets/:name', (req, res) => {
            try {
                const presets = this.api.getConfig('presets') || {};
                presets[req.params.name] = {
                    config: { ...this.config },
                    createdAt: new Date().toISOString()
                };
                this.api.setConfig('presets', presets);
                res.json({ success: true, message: `Preset "${req.params.name}" saved` });
            } catch (error) {
                this.api.log(`❌ [FLAME OVERLAY] Error saving preset: ${error.message}`, 'error');
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // POST /api/flame-overlay/presets/:name/load - Load preset
        this.api.registerRoute('post', '/api/flame-overlay/presets/:name/load', (req, res) => {
            try {
                const presets = this.api.getConfig('presets') || {};
                if (!presets[req.params.name]) {
                    return res.status(404).json({ success: false, error: 'Preset not found' });
                }
                this.config = { ...this.config, ...presets[req.params.name].config };
                this.saveConfig();
                this.api.emit('flame-overlay:config-update', { config: this.config });
                res.json({ success: true, message: `Preset "${req.params.name}" loaded` });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // DELETE /api/flame-overlay/presets/:name - Delete preset
        this.api.registerRoute('delete', '/api/flame-overlay/presets/:name', (req, res) => {
            try {
                const presets = this.api.getConfig('presets') || {};
                if (!presets[req.params.name]) {
                    return res.status(404).json({ success: false, error: 'Preset not found' });
                }
                delete presets[req.params.name];
                this.api.setConfig('presets', presets);
                res.json({ success: true, message: `Preset "${req.params.name}" deleted` });
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
    }

    /**
     * Register TikTok event handlers for dynamic effect reactions
     */
    registerTikTokEventHandlers() {
        // Gift → briefly boost flame intensity
        this.api.registerTikTokEvent('gift', (data) => {
            const coins = data.diamondCount || data.coins || 1;
            const boostIntensity = Math.min(2.5, 1.0 + (coins / 100));
            const boostDuration = Math.min(15000, 3000 + (coins * 50));
            
            this.api.emit('flame-overlay:effect-burst', {
                type: 'intensity-boost',
                intensity: boostIntensity,
                duration: boostDuration,
                effectType: coins >= 500 ? 'lightning' : this.config.effectType,
                color: coins >= 100 ? '#ff0000' : this.config.flameColor
            });
            
            this.api.log(`🔥 [FLAME OVERLAY] Gift burst: ${data.uniqueId} sent ${coins} coins → intensity ${boostIntensity}`, 'debug');
        });

        // Like → pulse burst on many likes
        this.api.registerTikTokEvent('like', (data) => {
            const likeCount = data.likeCount || data.totalLikeCount || 1;
            if (likeCount >= 50) {
                this.api.emit('flame-overlay:effect-burst', {
                    type: 'pulse-burst',
                    pulseAmount: Math.min(0.8, likeCount / 500),
                    duration: 5000
                });
            }
        });

        // Subscribe → temporary effect switch to particles
        this.api.registerTikTokEvent('subscribe', (data) => {
            this.api.emit('flame-overlay:effect-burst', {
                type: 'effect-switch',
                effectType: 'particles',
                duration: 10000,
                color: '#ffdd00'
            });
        });

        // Follow → short glow burst
        this.api.registerTikTokEvent('follow', (data) => {
            this.api.emit('flame-overlay:effect-burst', {
                type: 'intensity-boost',
                intensity: 1.5,
                duration: 3000,
                color: '#00ffaa'
            });
        });

        this.api.log('🔥 [FLAME OVERLAY] TikTok event handlers registered', 'info');
    }

    /**
     * Register flow system action handlers
     */
    registerFlowActions() {
        this.api.registerSocket('flow:flame-overlay:trigger', (data) => {
            this.api.emit('flame-overlay:effect-burst', {
                type: data.burstType || 'intensity-boost',
                effectType: data.effectType || this.config.effectType,
                intensity: data.intensity || 2.0,
                color: data.color || this.config.flameColor,
                duration: data.duration || 5000
            });
            this.api.log(`🔥 [FLAME OVERLAY] Flow triggered: ${data.burstType || 'intensity-boost'}`, 'debug');
        });
        
        this.api.log('🔥 [FLAME OVERLAY] Flow actions registered', 'info');
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
        this.api.log('   - GET  /api/flame-overlay/presets', 'info');
        this.api.log('   - POST /api/flame-overlay/presets/:name', 'info');
        this.api.log('   - POST /api/flame-overlay/presets/:name/load', 'info');
        this.api.log('   - DELETE /api/flame-overlay/presets/:name', 'info');
    }

    /**
     * Cleanup on plugin destroy
     */
    async destroy() {
        this.api.log('🔥 [FLAME OVERLAY] Plugin destroyed', 'info');
    }
}

module.exports = FlameOverlayPlugin;
