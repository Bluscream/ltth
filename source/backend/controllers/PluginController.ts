import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { PluginLoader } from '../modules/PluginLoader';
import { ILogger } from '../modules/LoggerService';
import { Server as SocketServer } from 'socket.io';
import fs from 'fs';
import path from 'path';
import { extract } from 'zip-lib';

export class PluginController extends BaseController {
    constructor(
        private readonly pluginLoader: PluginLoader,
        private readonly io: SocketServer | null,
        logger: ILogger
    ) {
        super(logger);
    }

    public getAllPlugins = (req: Request, res: Response) => {
        try {
            const locale = (req.query.locale as string) || 'en';
            const loadedPlugins = this.pluginLoader.getAllPlugins(locale);
            
            // Scan for all plugins (including disabled ones)
            const pluginsDir = this.pluginLoader['pluginsDir']; // Accessed via index for scan
            const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
            const allPlugins: any[] = [];

            // Add loaded plugins
            for (const plugin of loadedPlugins) {
                allPlugins.push({ ...plugin, enabled: true });
            }

            // Add non-loaded plugins
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== '_uploads') {
                    const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
                    if (fs.existsSync(manifestPath)) {
                        try {
                            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                            if (manifest.disabled === true) continue;
                            if (allPlugins.find(p => p.id === manifest.id)) continue;

                            const state = (this.pluginLoader as any).state[manifest.id] || {};
                            allPlugins.push({
                                id: manifest.id,
                                name: manifest.name,
                                description: (this.pluginLoader as any).getLocalizedDescription(manifest, locale),
                                version: manifest.version,
                                author: manifest.author,
                                type: manifest.type,
                                enabled: state.enabled === true,
                                loadedAt: null
                            });
                        } catch (err) {
                            this.logger.warn(`Malformed plugin.json in ${entry.name}`);
                        }
                    }
                }
            }

            this.sendSuccess(res, { plugins: allPlugins });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public getPluginDetails = (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const locale = (req.query.locale as string) || 'en';
            const plugin = this.pluginLoader.getPlugin(id);

            if (!plugin) return res.status(404).json({ success: false, error: 'Plugin not found' });

            this.sendSuccess(res, {
                plugin: {
                    id: plugin.metadata.id,
                    name: plugin.metadata.name,
                    description: (this.pluginLoader as any).getLocalizedDescription(plugin.metadata, locale),
                    version: plugin.metadata.version,
                    author: plugin.metadata.author,
                    type: plugin.metadata.type,
                    enabled: true,
                    loadedAt: plugin.loadedAt,
                    routes: plugin.api.getRegisteredRoutes(),
                    socketEvents: plugin.api.getRegisteredSocketEvents().map(e => e.event),
                    tiktokEvents: plugin.api.getRegisteredTikTokEvents().map(e => e.event)
                }
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public enablePlugin = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            await this.pluginLoader.enablePlugin(id);
            if (this.io) this.io.emit('plugins:changed', { action: 'enabled', pluginId: id });
            this.sendSuccess(res, { message: `Plugin ${id} enabled` });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public disablePlugin = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const success = await this.pluginLoader.disablePlugin(id);
            if (success) {
                if (this.io) this.io.emit('plugins:changed', { action: 'disabled', pluginId: id });
                this.sendSuccess(res, { message: `Plugin ${id} disabled` });
            } else {
                this.sendError(res, 'Failed to disable plugin');
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public reloadPlugin = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const success = await this.pluginLoader.reloadPlugin(id);
            if (success) {
                if (this.io) this.io.emit('plugins:changed', { action: 'reloaded', pluginId: id });
                this.sendSuccess(res, { message: `Plugin ${id} reloaded` });
            } else {
                this.sendError(res, 'Failed to reload plugin');
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public deletePlugin = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const success = await this.pluginLoader.deletePlugin(id);
            if (success) {
                if (this.io) this.io.emit('plugins:changed', { action: 'deleted', pluginId: id });
                this.sendSuccess(res, { message: `Plugin ${id} deleted` });
            } else {
                this.sendError(res, 'Failed to delete plugin');
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public getPluginLog = (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const logPath = path.join(__dirname, '..', '..', 'logs', `${id}.log`);

            if (!fs.existsSync(logPath)) return res.json({ success: true, logs: [] });

            const logContent = fs.readFileSync(logPath, 'utf8');
            const lines = logContent.split('\n').filter(line => line.trim());
            this.sendSuccess(res, { logs: lines.slice(-100) });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public uploadPlugin = async (req: Request, res: Response) => {
        if (!req.file) return this.sendError(res, 'No file uploaded', 'Error', 400);

        const zipPath = req.file.path;
        const tempDir = path.join(this.pluginLoader.pluginsDir, '_uploads', `temp-${Date.now()}`);

        try {
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            await extract(zipPath, tempDir);

            // Find manifest
            let manifestPath: string | null = null;
            let pluginSourceDir = tempDir;

            if (fs.existsSync(path.join(tempDir, 'plugin.json'))) {
                manifestPath = path.join(tempDir, 'plugin.json');
            } else {
                const entries = fs.readdirSync(tempDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const possible = path.join(tempDir, entry.name, 'plugin.json');
                        if (fs.existsSync(possible)) {
                            manifestPath = possible;
                            pluginSourceDir = path.join(tempDir, entry.name);
                            break;
                        }
                    }
                }
            }

            if (!manifestPath) throw new Error('No plugin.json found in ZIP');

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.id || !manifest.name || !manifest.entry) throw new Error('Invalid plugin.json');

            const targetDir = path.join(this.pluginLoader.pluginsDir, manifest.id);

            // Replace existing
            if (fs.existsSync(targetDir)) {
                await this.pluginLoader.deletePlugin(manifest.id);
            }

            fs.renameSync(pluginSourceDir, targetDir);

            // Load new plugin
            const plugin = await (this.pluginLoader as any).loadPlugin(targetDir);

            if (plugin) {
                if (this.io) this.io.emit('plugins:changed', { action: 'uploaded', pluginId: manifest.id });
                this.sendSuccess(res, { message: 'Plugin uploaded and loaded successfully', id: manifest.id });
            } else {
                throw new Error('Failed to load plugin after upload');
            }

        } catch (error: any) {
            this.logger.error(`Plugin upload failed: ${error.message}`);
            this.sendError(res, error.message);
        } finally {
            // Cleanup
            if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        }
    };
}
