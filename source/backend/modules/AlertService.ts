import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';
import { PluginLoader } from './PluginLoader';

export interface AlertConfig {
    event_type: string;
    enabled: boolean;
    text_template: string;
    sound_file: string | null;
    sound_volume: number;
    duration: number;
    image_url?: string | null;
    animation_type?: string;
}

export interface AlertData {
    username: string;
    nickname?: string;
    message?: string;
    giftId?: string;
    giftName?: string;
    coins?: number;
    repeatCount?: number;
    likeCount?: number;
    totalCoins?: number;
    profilePictureUrl?: string | null;
    giftPictureUrl?: string | null;
}

export interface QueuedAlert {
    type: string;
    data: AlertData;
    text: string;
    soundFile: string | null;
    soundVolume: number;
    duration: number;
    image: string | null;
    timestamp: number;
}

export class AlertService {
    private queue: QueuedAlert[] = [];
    private isProcessing = false;
    private currentAlert: QueuedAlert | null = null;
    private readonly MAX_QUEUE_SIZE = 100;
    private readonly QUEUE_WARNING_THRESHOLD = 0.8;

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer,
        private readonly logger: ILogger,
        private pluginLoader?: PluginLoader
    ) {}

    public setPluginLoader(pluginLoader: PluginLoader): void {
        this.pluginLoader = pluginLoader;
    }

    public addAlert(type: string, data: AlertData, customConfig: AlertConfig | null = null): void {
        try {
            let config = customConfig || this.getAlertConfig(type);

            if (!config) {
                config = this.getDefaultConfig(type);
            }

            if (!config.enabled) {
                this.logger.debug(`Alert for ${type} is disabled`);
                return;
            }

            const renderedText = this.renderTemplate(config.text_template, data);

            let soundFile = config.sound_file;
            let soundVolume = config.sound_volume;

            // Integration with Soundboard plugin (Legacy logic preservation)
            // This part might need further refinement as plugins are migrated
            
            const alert: QueuedAlert = {
                type,
                data,
                text: renderedText,
                soundFile,
                soundVolume,
                duration: (config.duration || 5) * 1000,
                image: data.giftPictureUrl || data.profilePictureUrl || null,
                timestamp: Date.now()
            };

            if (this.queue.length >= this.MAX_QUEUE_SIZE) {
                this.logger.error(`Alert queue full (${this.MAX_QUEUE_SIZE}), alert rejected: ${type}`);
                this.io.emit('alert:queue-full', { type, queueSize: this.queue.length });
                return;
            }

            if (this.queue.length >= this.MAX_QUEUE_SIZE * this.QUEUE_WARNING_THRESHOLD) {
                this.logger.warn(`Alert queue near capacity: ${this.queue.length}/${this.MAX_QUEUE_SIZE}`);
                this.io.emit('alert:queue-warning', { queueSize: this.queue.length });
            }

            this.queue.push(alert);
            this.logger.info(`[ALERT] Queued: ${type} - ${renderedText}`);
            this.processQueue();

        } catch (error: any) {
            this.logger.error('Failed to add alert:', error);
        }
    }

    private processQueue(): void {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        this.currentAlert = this.queue.shift()!;

        this.io.emit('alert:show', {
            type: this.currentAlert.type,
            text: this.currentAlert.text,
            soundFile: this.currentAlert.soundFile,
            soundVolume: this.currentAlert.soundVolume,
            duration: this.currentAlert.duration,
            image: this.currentAlert.image,
            data: this.currentAlert.data
        });

        setTimeout(() => {
            this.isProcessing = false;
            this.currentAlert = null;
            this.processQueue();
        }, this.currentAlert.duration + 500);
    }

    private getAlertConfig(type: string): AlertConfig | null {
        // This is a bridge until DatabaseService has proper alert methods
        const row = this.db.get('SELECT * FROM alert_configs WHERE event_type = ?', type) as any;
        if (!row) return null;
        return {
            ...row,
            enabled: row.enabled === 1 || row.enabled === true
        };
    }

    private renderTemplate(template: string, data: AlertData): string {
        const username = data.username || 'Viewer';
        const variables: Record<string, string> = {
            '{username}': username,
            '{nickname}': data.nickname || username,
            '{message}': data.message || '',
            '{gift_name}': data.giftName || '',
            '{coins}': (data.coins || 0).toString(),
            '{repeat_count}': (data.repeatCount || 1).toString(),
            '{like_count}': (data.likeCount || 0).toString(),
            '{total_coins}': (data.totalCoins || 0).toString()
        };

        let rendered = template;
        for (const [key, value] of Object.entries(variables)) {
            rendered = rendered.replace(new RegExp(key, 'g'), value);
        }
        return rendered;
    }

    private getDefaultConfig(type: string): AlertConfig {
        const defaults: Record<string, Partial<AlertConfig>> = {
            gift: { text_template: '{username} sent {gift_name} x{repeat_count}!', duration: 5 },
            follow: { text_template: '{username} followed!', duration: 4 },
            subscribe: { text_template: '{username} subscribed!', duration: 6 },
            share: { text_template: '{username} shared the stream!', duration: 4 },
            like: { text_template: '{username} liked!', duration: 2, enabled: false }
        };

        const config = defaults[type] || { text_template: '{username}', duration: 5 };
        return {
            event_type: type,
            enabled: true,
            sound_file: null,
            sound_volume: 80,
            text_template: '{username}',
            duration: 5,
            ...config
        } as AlertConfig;
    }

    public clearQueue(): void {
        this.queue = [];
        this.isProcessing = false;
        this.currentAlert = null;
    }

    public skipCurrent(): void {
        if (this.currentAlert) {
            this.io.emit('alert:hide');
            this.isProcessing = false;
            this.currentAlert = null;
            this.processQueue();
        }
    }
}
