import { ILogger } from '../LoggerService';

export interface TriggerField {
    name: string;
    label: string;
    type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect';
    options?: string[];
}

export interface TriggerConfig {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    fields: TriggerField[];
    metadata: Record<string, any>;
}

/**
 * TriggerRegistry - Central registry for all available triggers
 */
export class TriggerRegistry {
    private logger: ILogger;
    private triggers: Map<string, TriggerConfig> = new Map();

    constructor(logger: ILogger = console) {
        this.logger = logger;
        this.registerCoreTriggers();
    }

    public register(id: string, config: Partial<TriggerConfig>): void {
        const trigger: TriggerConfig = {
            id,
            name: config.name || id,
            description: config.description || '',
            category: config.category || 'custom',
            icon: config.icon || 'zap',
            fields: config.fields || [],
            metadata: config.metadata || {}
        };

        this.triggers.set(id, trigger);
    }

    public get(id: string): TriggerConfig | undefined {
        return this.triggers.get(id);
    }

    public getAll(): TriggerConfig[] {
        return Array.from(this.triggers.values());
    }

    public getByCategory(category: string): TriggerConfig[] {
        return this.getAll().filter(t => t.category === category);
    }

    private registerCoreTriggers(): void {
        this.register('tiktok:gift', {
            name: 'Gift Received',
            description: 'Triggered when a viewer sends a gift',
            category: 'tiktok',
            icon: 'gift',
            fields: [
                { name: 'giftName', label: 'Gift Name', type: 'text' },
                { name: 'coins', label: 'Coins', type: 'number' },
                { name: 'username', label: 'Username', type: 'text' }
            ]
        });

        this.register('tiktok:chat', {
            name: 'Chat Message',
            description: 'Triggered when a viewer sends a chat message',
            category: 'tiktok',
            icon: 'message-circle',
            fields: [
                { name: 'message', label: 'Message', type: 'text' },
                { name: 'username', label: 'Username', type: 'text' }
            ]
        });

        this.register('tiktok:follow', {
            name: 'New Follow',
            description: 'Triggered when someone follows the stream',
            category: 'tiktok',
            icon: 'user-plus',
            fields: [
                { name: 'username', label: 'Username', type: 'text' }
            ]
        });

        this.register('tiktok:like', {
            name: 'Likes Received',
            description: 'Triggered when someone likes the stream',
            category: 'tiktok',
            icon: 'heart',
            fields: [
                { name: 'likeCount', label: 'Like Count', type: 'number' },
                { name: 'username', label: 'Username', type: 'text' }
            ]
        });

        this.register('system:connected', {
            name: 'TikTok Connected',
            description: 'Triggered when connected to TikTok LIVE',
            category: 'system',
            icon: 'wifi',
            fields: []
        });

        this.register('timer:interval', {
            name: 'Interval Timer',
            description: 'Triggered at regular intervals',
            category: 'timer',
            icon: 'clock',
            fields: [
                { name: 'intervalSeconds', label: 'Interval (seconds)', type: 'number' }
            ]
        });
    }
}
