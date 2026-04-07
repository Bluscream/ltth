import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import express, { Application, Router } from 'express';
import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';
import { ConfigPathManager } from './ConfigPathManager';
import { IFTTTService } from './ifttt/IFTTTService';
import { PluginAPI } from './PluginAPI';
import { PluginMetadata, PluginState, PluginBackupProvider } from '../types/plugins';

export class PluginLoader extends EventEmitter {
    private plugins: Map<string, { metadata: PluginMetadata; api: PluginAPI; instance: any }> = new Map();
    private pluginRouter: Router;
    private stateFile: string;
    private legacyStateFile: string;
    private state: Record<string, PluginState>;
    private tiktok: any = null;
    private iftttService: IFTTTService | null = null;
    private backupManager: any = null;

    constructor(
    public readonly pluginsDir: string,
    private readonly app: Application,
    private readonly io: SocketServer,
    private readonly db: DatabaseService,
    private readonly logger: ILogger,
    private readonly configPathManager: ConfigPathManager,
    private readonly activeProfile: string = 'default'
    ) {
        super();
        this.pluginRouter = Router();
        this.app.use(this.pluginRouter);
        
        this.legacyStateFile = path.join(pluginsDir, 'plugins_state.json');
        this.stateFile = this.resolveStateFilePath();
        this.ensureStateDirectory();
        this.state = this.loadState();
        
        this.logger.info(`🔌 PluginLoader initialized (profile: ${activeProfile})`);
    }

    public getPluginRouter(): Router {
        return this.pluginRouter;
    }

    public setTikTokModule(tiktok: any): void {
        this.tiktok = tiktok;
    }

    public setIFTTTService(service: IFTTTService): void {
        this.iftttService = service;
    }

    public setBackupManager(manager: any): void {
        this.backupManager = manager;
    }

    private resolveStateFilePath(): string {
        const baseDir = this.configPathManager.getUserConfigsDir();
        const sanitizedProfile = this.activeProfile.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(baseDir, `${sanitizedProfile}_plugins_state.json`);
    }

    private ensureStateDirectory(): void {
        const dir = path.dirname(this.stateFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }

    private loadState(): Record<string, PluginState> {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }
            if (fs.existsSync(this.legacyStateFile)) {
                const legacy = JSON.parse(fs.readFileSync(this.legacyStateFile, 'utf8'));
                fs.writeFileSync(this.stateFile, JSON.stringify(legacy, null, 2));
                return legacy;
            }
        } catch (error: any) {
            this.logger.warn(`Failed to load plugin state: ${error.message}`);
        }
        return {};
    }

    public saveState(): void {
        fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    }

    public async loadAllPlugins(): Promise<void> {
        if (!fs.existsSync(this.pluginsDir)) fs.mkdirSync(this.pluginsDir, { recursive: true });
        const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        const pluginDirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('_'));

        for (const dir of pluginDirs) {
            const pluginPath = path.join(this.pluginsDir, dir.name);
            await this.loadPlugin(pluginPath);
        }
    }

    public async loadPlugin(pluginPath: string): Promise<boolean> {
        const pluginId = path.basename(pluginPath);
        try {
            const packagePath = path.join(pluginPath, 'package.json');
            if (!fs.existsSync(packagePath)) return false;

            const metadata: PluginMetadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            metadata.id = pluginId;

            const api = new PluginAPI(
                pluginId, pluginPath, this.app, this.io, this.db, this.logger,
                this, this.configPathManager, this.iftttService!, this.tiktok
            );

            const entryPoint = metadata.entryPoint || 'index.js';
            const fullEntryPoint = path.join(pluginPath, entryPoint);
            
            // In a real environment, we would use dynamic import() or require()
            // For now, we simulate the loading.
            this.logger.info(`📦 Loading plugin: ${metadata.name} (v${metadata.version})`);

            this.plugins.set(pluginId, { metadata, api, instance: null });
            
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
            // Integration logic here (e.g., calling init() on plugin instance)
            this.state[pluginId] = { ...this.state[pluginId], enabled: true };
            this.saveState();
            this.emit('plugin:enabled', pluginId);
            return true;
        } catch (error: any) {
            this.logger.error(`Error enabling plugin ${pluginId}: ${error.message}`);
            return false;
        }
    }

    public async disablePlugin(pluginId: string): Promise<boolean> {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return false;

        try {
            plugin.api.unregisterAll();
            this.state[pluginId] = { ...this.state[pluginId], enabled: false };
            this.saveState();
            this.emit('plugin:disabled', pluginId);
            return true;
        } catch (error: any) {
            this.logger.error(`Error disabling plugin ${pluginId}: ${error.message}`);
            return false;
        }
    }

    public getPlugins(): PluginMetadata[] {
        return Array.from(this.plugins.values()).map(p => ({
            ...p.metadata,
            enabled: this.state[p.metadata.id]?.enabled !== false
        } as any));
    }

    public getAllPlugins(locale: string = 'en'): any[] {
        return Array.from(this.plugins.values()).map(p => ({
            id: p.metadata.id,
            name: p.metadata.name,
            description: this.getLocalizedDescription(p.metadata, locale),
            version: p.metadata.version,
            author: p.metadata.author,
            type: p.metadata.type,
            enabled: true,
            loadedAt: (p as any).loadedAt || new Date().toISOString()
        }));
    }

    public getPlugin(id: string): { metadata: PluginMetadata; api: PluginAPI; instance: any; loadedAt?: string } | undefined {
        return this.plugins.get(id);
    }

    public async reloadPlugin(id: string): Promise<boolean> {
        const plugin = this.plugins.get(id);
        if (!plugin) return false;
        await this.disablePlugin(id);
        const pluginPath = path.join(this.pluginsDir, id);
        return await this.loadPlugin(pluginPath);
    }

    public async deletePlugin(id: string): Promise<boolean> {
        await this.disablePlugin(id);
        this.plugins.delete(id);
        const pluginPath = path.join(this.pluginsDir, id);
        if (fs.existsSync(pluginPath)) {
            fs.rmSync(pluginPath, { recursive: true, force: true });
            return true;
        }
        return false;
    }

    public getPluginState(id: string): PluginState | undefined {
        return this.state[id];
    }

    public getLocalizedDescription(manifest: any, locale: string): string {
        if (manifest.descriptions && manifest.descriptions[locale]) {
            return manifest.descriptions[locale];
        }
        return manifest.description || '';
    }

    public registerBackupProvider(pluginId: string, provider: PluginBackupProvider): void {
        if (this.backupManager) this.backupManager.registerBackupProvider(pluginId, provider);
    }

    public unregisterBackupProvider(pluginId: string): void {
        if (this.backupManager) this.backupManager.unregisterBackupProvider(pluginId);
    }

    public registerPluginsIFTTT(iftttService: IFTTTService): void {
        for (const [id, plugin] of this.plugins.entries()) {
            if (this.state[id]?.enabled !== false && plugin.instance && typeof plugin.instance.registerIFTTT === 'function') {
                try {
                    plugin.instance.registerIFTTT(iftttService);
                    this.logger.info(`✅ Registered IFTTT components for plugin: ${id}`);
                } catch (error: any) {
                    this.logger.error(`❌ Plugin "${id}" failed to register IFTTT components: ${error.message}`);
                }
            }
        }
    }
}
