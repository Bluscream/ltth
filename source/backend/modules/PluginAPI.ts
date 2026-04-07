import { Application, Request, Response, NextFunction } from 'express';
import { Server as SocketServer, Socket } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';
import { ConfigPathManager } from './ConfigPathManager';
import { IFTTTService } from './ifttt/IFTTTService';
import { RegisteredRoute, RegisteredSocketEvent, RegisteredTikTokEvent, PluginBackupProvider } from '../types/plugins';

export class PluginAPI {
    private registeredRoutes: RegisteredRoute[] = [];
    private registeredSocketEvents: RegisteredSocketEvent[] = [];
    private registeredTikTokEvents: RegisteredTikTokEvent[] = [];
    private backupProviderRegistered = false;

    constructor(
        public readonly pluginId: string,
        public readonly pluginDir: string,
        private readonly app: Application,
        private readonly io: SocketServer,
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private readonly pluginLoader: any, // To avoid circular dependency
        private readonly configPathManager: ConfigPathManager,
        private readonly iftttService?: IFTTTService,
        private readonly tiktok?: any
    ) {}

    public registerRoute(method: string, routePath: string, handler: RequestHandler): boolean {
        try {
            const fullPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
            const wrappedHandler = async (req: Request, res: Response, next: NextFunction) => {
                try {
                    await (handler as any)(req, res, next);
                } catch (error: any) {
                    this.log(`Route error in ${fullPath}: ${error.message}`, 'error');
                    res.status(500).json({ success: false, error: 'Plugin route error', message: error.message });
                }
            };

            const methodLower = method.toLowerCase() as any;
            const router = this.pluginLoader.getPluginRouter();
            
            if (router[methodLower]) {
                router[methodLower](fullPath, wrappedHandler);
                this.registeredRoutes.push({ method, path: fullPath });
                this.log(`Registered route: ${method} ${fullPath}`);
                return true;
            }
            return false;
        } catch (error: any) {
            this.log(`Failed to register route: ${error.message}`, 'error');
            return false;
        }
    }

    public registerSocket(event: string, callback: (socket: Socket, ...args: any[]) => void): boolean {
        try {
            const wrappedCallback = async (socket: Socket, ...args: any[]) => {
                try {
                    await callback(socket, ...args);
                } catch (error: any) {
                    this.log(`Socket event error in ${event}: ${error.message}`, 'error');
                    socket.emit('plugin:error', { plugin: this.pluginId, event, error: error.message });
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

    public registerTikTokEvent(event: string, callback: (data: any) => void): boolean {
        try {
            const wrappedCallback = async (data: any) => {
                try { await callback(data); } catch (error: any) { this.log(`TikTok event error in ${event}: ${error.message}`, 'error'); }
            };
            this.registeredTikTokEvents.push({ event, callback: wrappedCallback });
            this.log(`Registered TikTok event (queued): ${event}`);
            return true;
        } catch (error: any) {
            this.log(`Failed to register TikTok event: ${error.message}`, 'error');
            return false;
        }
    }

    public registerIFTTTTrigger(id: string, config: any): boolean {
        if (!this.iftttService) return false;
        const triggerId = id.includes(':') ? id : `${this.pluginId}:${id}`;
        if (!config.category) config.category = this.pluginId;
        this.iftttService.triggers.register(triggerId, config);
        this.log(`Registered IFTTT trigger: ${triggerId}`);
        return true;
    }

    public registerIFTTTCondition(id: string, config: any): boolean {
        if (!this.iftttService) return false;
        const conditionId = id.includes(':') ? id : `${this.pluginId}:${id}`;
        if (!config.category) config.category = this.pluginId;
        this.iftttService.conditions.register(conditionId, config);
        this.log(`Registered IFTTT condition: ${conditionId}`);
        return true;
    }

    public registerIFTTTAction(id: string, config: any): boolean {
        if (!this.iftttService) return false;
        const actionId = id.includes(':') ? id : `${this.pluginId}:${id}`;
        if (!config.category) config.category = this.pluginId;
        this.iftttService.actions.register(actionId, config);
        this.log(`Registered IFTTT action: ${actionId}`);
        return true;
    }

    public getRegisteredRoutes(): RegisteredRoute[] {
        return this.registeredRoutes;
    }

    public getRegisteredSocketEvents(): RegisteredSocketEvent[] {
        return this.registeredSocketEvents;
    }

    public getRegisteredTikTokEvents(): RegisteredTikTokEvent[] {
        return this.registeredTikTokEvents;
    }

    public emit(event: string, data: any): void {
        this.io.emit(event, data);
    }

    public getConfig(key: string = 'config'): any {
        const configKey = `plugin:${this.pluginId}:${key}`;
        const val = this.db.getSetting(configKey);
        try { return val ? JSON.parse(val) : null; } catch { return val; }
    }

    public setConfig(key: string, value: any): void {
        const configKey = `plugin:${this.pluginId}:${key}`;
        this.db.setSetting(configKey, JSON.stringify(value));
        this.log(`Config saved: ${key}`);
    }

    public log(message: string, level: keyof ILogger = 'info'): void {
        const logMessage = `[Plugin:${this.pluginId}] ${message}`;
        (this.logger[level] as any)(logMessage);
    }

    public getPluginDataDir(): string {
        return this.configPathManager.getPluginDataDir(this.pluginId);
    }

    public ensurePluginDataDir(): string {
        const dir = this.getPluginDataDir();
        const fs = require('fs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    public registerBackupProvider(provider: PluginBackupProvider): boolean {
        if (this.pluginLoader?.registerBackupProvider) {
            this.pluginLoader.registerBackupProvider(this.pluginId, provider);
            this.backupProviderRegistered = true;
            this.log('Backup provider registered');
            return true;
        }
        return false;
    }

    public unregisterAll(): void {
        this.registeredSocketEvents.forEach(({ event, callback }) => {
            this.io.sockets.sockets.forEach(socket => socket.removeListener(event, callback as any));
        });
        this.registeredTikTokEvents.forEach(({ event, callback }) => {
            if (this.tiktok) this.tiktok.removeListener(event, callback);
        });
        if (this.iftttService) {
            // Logic to unregister from IFTTT service
        }
        if (this.backupProviderRegistered && this.pluginLoader?.unregisterBackupProvider) {
            this.pluginLoader.unregisterBackupProvider(this.pluginId);
        }
        this.log('All registrations cleared (except Express routes)');
    }
}

type RequestHandler = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;
