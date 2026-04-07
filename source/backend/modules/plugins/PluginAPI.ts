import { Express } from 'express';
import { Server } from 'socket.io';
import { DatabaseService } from '../DatabaseService';
import { ILogger } from '../LoggerService';
import { ConfigPathManager } from '../ConfigPathManager';
import { TikTokConnector } from '../tiktok/TikTokConnector';
import { 
    RegisteredRoute, 
    RegisteredSocketEvent, 
    RegisteredTikTokEvent, 
    FlowAction, 
    BackupProvider 
} from './types';

export class PluginAPI {
    public registeredRoutes: RegisteredRoute[] = [];
    public registeredSocketEvents: RegisteredSocketEvent[] = [];
    public registeredTikTokEvents: RegisteredTikTokEvent[] = [];
    public registeredFlowActions: FlowAction[] = [];
    public backupProviderRegistered: boolean = false;

    constructor(
        public readonly pluginId: string,
        public readonly pluginDir: string,
        private readonly app: Express,
        private readonly io: Server,
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private readonly pluginManager: any, // To be replaced with PluginManager
        private readonly configPathManager: ConfigPathManager,
        private readonly iftttEngine: any = null,
        private readonly tiktok: TikTokConnector | null = null
    ) {}

    public registerRoute(method: string, routePath: string, handler: Function): boolean {
        try {
            const fullPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
            const wrappedHandler = async (req: any, res: any, next: any) => {
                try {
                    await handler(req, res, next);
                } catch (error: any) {
                    this.log(`Route error in ${fullPath}: ${error.message}`, 'error');
                    res.status(500).json({
                        success: false,
                        error: 'Plugin route error',
                        message: error.message
                    });
                }
            };

            const methodLower = method.toLowerCase();
            const router = this.pluginManager.getPluginRouter();
            
            if (!(router as any)[methodLower]) {
                throw new Error(`Invalid HTTP method: ${method}`);
            }

            (router as any)[methodLower](fullPath, wrappedHandler);
            this.registeredRoutes.push({ method, path: fullPath });
            this.log(`Registered route: ${method} ${fullPath}`);

            return true;
        } catch (error: any) {
            this.log(`Failed to register route: ${error.message}`, 'error');
            return false;
        }
    }

    public registerSocket(event: string, callback: Function): boolean {
        try {
            const wrappedCallback = async (socket: any, ...args: any[]) => {
                try {
                    await callback(socket, ...args);
                } catch (error: any) {
                    this.log(`Socket event error in ${event}: ${error.message}`, 'error');
                    socket.emit('plugin:error', {
                        plugin: this.pluginId,
                        event,
                        error: error.message
                    });
                }
            };

            this.registeredSocketEvents.push({ event, callback: wrappedCallback });
            this.log(`Registered socket event: ${event}`);

            return true;
        } catch (error: any) {
            this.log(`Failed to register socket event: ${error.message}`, 'error');
            return false;
        }
    }

    public registerTikTokEvent(event: string, callback: Function): boolean {
        try {
            const wrappedCallback = async (data: any) => {
                try {
                    await callback(data);
                } catch (error: any) {
                    this.log(`TikTok event error in ${event}: ${error.message}`, 'error');
                }
            };

            this.registeredTikTokEvents.push({ event, callback: wrappedCallback });
            this.log(`Registered TikTok event (queued): ${event}`);

            return true;
        } catch (error: any) {
            this.log(`Failed to register TikTok event: ${error.message}`, 'error');
            return false;
        }
    }

    public registerFlowAction(actionName: string, handler: Function): boolean {
        try {
            const wrappedHandler = async (params: any) => {
                try {
                    return await handler(params);
                } catch (error: any) {
                    this.log(`Flow action error in ${actionName}: ${error.message}`, 'error');
                    return {
                        success: false,
                        error: error.message
                    };
                }
            };

            this.registeredFlowActions.push({
                actionName,
                handler: wrappedHandler,
                pluginId: this.pluginId
            });
            this.log(`Registered flow action: ${actionName}`);

            return true;
        } catch (error: any) {
            this.log(`Failed to register flow action: ${error.message}`, 'error');
            return false;
        }
    }

    public emit(event: string, data: any): boolean {
        try {
            this.io.emit(event, data);
            return true;
        } catch (error: any) {
            this.log(`Failed to emit event: ${error.message}`, 'error');
            return false;
        }
    }

    public getConfig(key: string | null = null): any {
        try {
            const configKey = key ? `plugin:${this.pluginId}:${key}` : `plugin:${this.pluginId}:config`;
            const row = (this.db as any).prepare('SELECT value FROM settings WHERE key = ?').get(configKey);

            if (row) {
                return JSON.parse(row.value);
            }
            return null;
        } catch (error: any) {
            this.log(`Failed to get config: ${error.message}`, 'error');
            return null;
        }
    }

    public setConfig(key: string, value: any): boolean {
        try {
            const configKey = `plugin:${this.pluginId}:${key}`;
            const valueJson = JSON.stringify(value);

            (this.db as any).prepare(`
                INSERT INTO settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `).run(configKey, valueJson);

            this.log(`Config saved: ${key}`);
            return true;
        } catch (error: any) {
            this.log(`Failed to set config: ${error.message}`, 'error');
            return false;
        }
    }

    public log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const logMessage = `[Plugin:${this.pluginId}] ${message}`;
        if (this.logger && this.logger[level]) {
            this.logger[level](logMessage);
        } else {
            console.log(`[${level.toUpperCase()}] ${logMessage}`);
        }
    }

    public unregisterAll(): void {
        this.registeredSocketEvents.forEach(({ event, callback }) => {
            try {
                this.io.sockets.sockets.forEach((socket: any) => {
                    socket.removeListener(event, callback);
                });
                this.log(`Unregistered socket event: ${event}`);
            } catch (error: any) {
                this.log(`Failed to unregister socket event ${event}: ${error.message}`, 'error');
            }
        });

        this.registeredTikTokEvents.forEach(({ event, callback }) => {
            try {
                if (this.tiktok) {
                    this.tiktok.removeListener(event, callback as any);
                    this.log(`Unregistered TikTok event: ${event}`);
                }
            } catch (error: any) {
                this.log(`Failed to unregister TikTok event ${event}: ${error.message}`, 'error');
            }
        });

        if (this.registeredRoutes.length > 0) {
            this.log(`⚠️ WARNING: ${this.registeredRoutes.length} Express routes cannot be unregistered`, 'warn');
        }

        this.registeredSocketEvents = [];
        this.registeredTikTokEvents = [];
        this.registeredFlowActions = [];

        if (this.backupProviderRegistered) {
            this.pluginManager.unregisterBackupProvider(this.pluginId);
            this.backupProviderRegistered = false;
        }

        this.log('All registrations cleared (except Express routes)');
    }

    public registerBackupProvider(provider: BackupProvider): boolean {
        try {
            if (this.pluginManager && typeof this.pluginManager.registerBackupProvider === 'function') {
                this.pluginManager.registerBackupProvider(this.pluginId, provider);
                this.backupProviderRegistered = true;
                this.log('Backup provider registered');
                return true;
            }
            return false;
        } catch (error: any) {
            this.log(`Failed to register backup provider: ${error.message}`, 'error');
            return false;
        }
    }
}
