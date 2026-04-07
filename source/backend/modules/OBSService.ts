import OBSWebSocket from 'obs-websocket-js';
import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export interface OBSConfig {
    enabled: boolean;
    host: string;
    port: number;
    password: string;
}

export interface OBSAction {
    type: 'switch_scene' | 'toggle_source' | 'set_filter' | 'delay';
    scene_name?: string;
    source_name?: string;
    filter_name?: string;
    visible?: boolean;
    enabled?: boolean;
    duration?: number;
}

export interface OBSEventMapping {
    event_type: string;
    conditions?: {
        field: string;
        operator: '>=' | '>' | '<=' | '<' | '==' | '!=';
        value: any;
    };
    action: OBSAction;
}

export class OBSService {
    private obs = new OBSWebSocket();
    private connected: boolean = false;
    private config: OBSConfig;
    private eventMappings: OBSEventMapping[];

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer | null = null,
        private readonly logger: ILogger
    ) {
        this.config = this.loadConfig();
        this.eventMappings = this.loadEventMappings();
    }

    private loadConfig(): OBSConfig {
        const config = this.db.getSetting('obs_websocket_config');
        return config ? JSON.parse(config) : {
            enabled: false,
            host: 'localhost',
            port: 4455,
            password: ''
        };
    }

    private loadEventMappings(): OBSEventMapping[] {
        const mappings = this.db.getSetting('obs_event_mappings');
        return mappings ? JSON.parse(mappings) : [];
    }

    public async saveConfig(config: Partial<OBSConfig>): Promise<void> {
        this.config = { ...this.config, ...config };
        this.db.setSetting('obs_websocket_config', JSON.stringify(this.config));
        this.logger.info('OBS config saved');
    }

    public async saveEventMappings(mappings: OBSEventMapping[]): Promise<void> {
        this.eventMappings = mappings;
        this.db.setSetting('obs_event_mappings', JSON.stringify(mappings));
        this.logger.info(`OBS event mappings saved (${mappings.length} items)`);
    }

    public async connect(host?: string, port?: number, password?: string): Promise<boolean> {
        const connectHost = host || this.config.host;
        const connectPort = port || this.config.port;
        const connectPassword = password || this.config.password;

        if (host || port || password) {
            await this.saveConfig({ host: connectHost, port: connectPort, password: connectPassword, enabled: true });
        }

        try {
            await this.obs.connect(`ws://${connectHost}:${connectPort}`, connectPassword);
            this.connected = true;
            this.logger.info(`Connected to OBS at ${connectHost}:${connectPort}`);

            if (this.io) {
                this.io.emit('obs:connected', { host: connectHost, port: connectPort });
            }
            return true;
        } catch (error: any) {
            this.connected = false;
            this.logger.error(`Failed to connect to OBS: ${error.message}`);
            if (this.io) {
                this.io.emit('obs:error', { error: error.message });
            }
            return false;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.connected) {
            try {
                await this.obs.disconnect();
                this.connected = false;
                this.logger.info('Disconnected from OBS');
                if (this.io) this.io.emit('obs:disconnected');
            } catch (error: any) {
                this.logger.error(`Failed to disconnect from OBS: ${error.message}`);
            }
        }
    }

    public async handleEvent(eventType: string, eventData: any): Promise<void> {
        if (!this.connected || !this.config.enabled) return;

        const matchingMappings = this.eventMappings.filter(mapping => {
            if (mapping.event_type !== eventType) return false;
            if (mapping.conditions) return this.checkConditions(mapping.conditions, eventData);
            return true;
        });

        for (const mapping of matchingMappings) {
            await this.executeAction(mapping.action, eventData);
        }
    }

    private checkConditions(conditions: any, eventData: any): boolean {
        const { field, operator, value } = conditions;
        const fieldValue = eventData[field];

        switch (operator) {
            case '>=': return fieldValue >= value;
            case '>': return fieldValue > value;
            case '<=': return fieldValue <= value;
            case '<': return fieldValue < value;
            case '==': return fieldValue == value;
            case '!=': return fieldValue != value;
            default: return false;
        }
    }

    public async executeAction(action: OBSAction, _eventData: any): Promise<void> {
        try {
            switch (action.type) {
                case 'switch_scene':
                    if (action.scene_name) await this.switchScene(action.scene_name);
                    break;
                case 'toggle_source':
                    if (action.scene_name && action.source_name)
                        await this.toggleSource(action.scene_name, action.source_name, action.visible ?? true);
                    break;
                case 'set_filter':
                    if (action.source_name && action.filter_name)
                        await this.setFilter(action.source_name, action.filter_name, action.enabled ?? true);
                    break;
                case 'delay':
                    if (action.duration) await new Promise(resolve => setTimeout(resolve, action.duration));
                    break;
            }
        } catch (error: any) {
            this.logger.error(`Failed to execute OBS action (${action.type}): ${error.message}`);
        }
    }

    public async switchScene(sceneName: string): Promise<void> {
        await this.obs.call('SetCurrentProgramScene', { sceneName });
    }

    public async toggleSource(sceneName: string, sourceName: string, visible: boolean): Promise<void> {
        const sceneItemId = await this.getSceneItemId(sceneName, sourceName);
        if (sceneItemId !== null) {
            await this.obs.call('SetSceneItemEnabled', {
                sceneName,
                sceneItemId,
                sceneItemEnabled: visible
            });
        }
    }

    public async setFilter(sourceName: string, filterName: string, enabled: boolean): Promise<void> {
        await this.obs.call('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: enabled });
    }

    public async getSceneItemId(sceneName: string, sourceName: string): Promise<number | null> {
        const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName });
        const item = (sceneItems as any[]).find(i => i.sourceName === sourceName);
        return item ? item.sceneItemId : null;
    }

    public async getScenes(): Promise<string[]> {
        if (!this.connected) return [];
        try {
            const { scenes } = await this.obs.call('GetSceneList');
            return (scenes as any[]).map(s => s.sceneName);
        } catch { return []; }
    }

    public getStatus(): any {
        return {
            connected: this.connected,
            enabled: this.config.enabled,
            host: this.config.host,
            port: this.config.port
        };
    }

    public isConnected(): boolean {
        return this.connected;
    }
}
