import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import express, { Express, Router } from 'express';
import { Server } from 'socket.io';
import { DatabaseService } from '../DatabaseService';
import { ILogger } from '../LoggerService';
import { ConfigPathManager } from '../ConfigPathManager';
import { TikTokConnector } from '../tiktok/TikTokConnector';
import { PluginAPI } from './PluginAPI';
import { PluginMetadata, PluginState, BackupProvider } from './types';

export class PluginManager extends EventEmitter {
    private plugins: Map<string, any> = new Map();
    private pluginApis: Map<string, PluginAPI> = new Map();
    private state: Record<string, PluginState> = {};
    private readonly stateFile: string;
    private readonly pluginRouter: Router;
    private tiktok: TikTokConnector | null = null;
    private iftttEngine: any = null;
    private backupManager: any = null;

    constructor(
        private readonly pluginsDir: string,
        private readonly app: Express,
        private readonly io: Server,
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private readonly configPathManager: ConfigPathManager,
        private readonly activeProfile: string | null = null
    ) {
        super();
        this.pluginRouter = express.Router();
        this.app.use(this.pluginRouter);
        this.stateFile = this.resolveStateFilePath();
        this.ensureStateDirectory();
        this.state = this.loadState();
        this.logger.info('🔌 PluginManager: Initialized');
    }

    private resolveStateFilePath(): string {
        const baseDir = this.configPathManager.getUserConfigsDir();
        const profileSegment = this.activeProfile ? `${this.sanitizeProfileName(this.activeProfile)}_` : '';
        return path.join(baseDir, `${profileSegment}plugins_state.json`);
    }

    private ensureStateDirectory(): void {
        const dir = path.dirname(this.stateFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    private sanitizeProfileName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    private loadState(): Record<string, PluginState> {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }
        } catch (error: any) {
            this.logger.warn(`Failed to load plugin state: ${error.message}`);
        }
        return {};
    }

    private saveState(): void {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (error: any) {
            this.logger.error(`Failed to save plugin state: ${error.message}`);
        }
    }

    public setTikTokModule(tiktok: TikTokConnector): void {
        this.tiktok = tiktok;
    }

    public setIFTTTEngine(engine: any): void {
        this.iftttEngine = engine;
    }

    public setBackupManager(manager: any): void {
        this.backupManager = manager;
    }

    public getPluginRouter(): Router {
        return this.pluginRouter;
    }

    public async loadAllPlugins(): Promise<void> {
        if (!fs.existsSync(this.pluginsDir)) {
            fs.mkdirSync(this.pluginsDir, { recursive: true });
        }

        const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        const pluginDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('_'));

        this.logger.info(`🔌 PluginManager: Found ${pluginDirs.length} plugin directories`);

        for (const dir of pluginDirs) {
            const pluginPath = path.join(this.pluginsDir, dir.name);
            await this.loadPlugin(pluginPath);
        }
    }

    public async loadPlugin(pluginPath: string): Promise<boolean> {
        const pluginId = path.basename(pluginPath);
        const metadataPath = path.join(pluginPath, 'plugin.json');

        if (!fs.existsSync(metadataPath)) {
            this.logger.warn(`Plugin metadata missing for ${pluginId}`);
            return false;
        }

        try {
            const metadata: PluginMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const entryPoint = path.join(pluginPath, metadata.entryPoint || 'index.js');

            if (!fs.existsSync(entryPoint)) {
                throw new Error(`Entry point not found: ${entryPoint}`);
            }

            const api = new PluginAPI(
                pluginId,
                pluginPath,
                this.app,
                this.io,
                this.db,
                this.logger,
                this,
                this.configPathManager,
                this.iftttEngine,
                this.tiktok
            );

            // Dynamically require plugin entry point
            // For ESM/TS compatibility in internal plugins, we might need import()
            const pluginModule = require(entryPoint);
            const pluginInstance = typeof pluginModule === 'function' ? new pluginModule(api) : pluginModule;

            this.plugins.set(pluginId, pluginInstance);
            this.pluginApis.set(pluginId, api);

            if (this.state[pluginId]?.enabled !== false) {
                await this.enablePlugin(pluginId);
            }

            return true;
        } catch (error: any) {
            this.logger.error(`Failed to load plugin ${pluginId}: ${error.message}`);
            return false;
        }
    }

    public async enablePlugin(pluginId: string): Promise<boolean> {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;

        try {
            if (typeof plugin.init === 'function') {
                await plugin.init();
            }
            this.state[pluginId] = { ...this.state[pluginId], enabled: true };
            this.saveState();
            this.logger.info(`✅ Plugin enabled: ${pluginId}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to enable plugin ${pluginId}: ${error.message}`);
            return false;
        }
    }

    public registerBackupProvider(pluginId: string, provider: BackupProvider): void {
        if (this.backupManager) {
            this.backupManager.registerBackupProvider(pluginId, provider);
        }
    }

    public unregisterBackupProvider(pluginId: string): void {
        if (this.backupManager) {
            this.backupManager.unregisterBackupProvider(pluginId);
        }
    }
}
