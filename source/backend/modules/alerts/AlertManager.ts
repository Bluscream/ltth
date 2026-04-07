import { Server } from 'socket.io';
import { DatabaseService } from '../DatabaseService';
import { ILogger } from '../LoggerService';
import { PluginManager } from '../plugins/PluginManager';
import { Alert, AlertConfig } from './types';

export class AlertManager {
    private queue: Alert[] = [];
    private isProcessing: boolean = false;
    private currentAlert: Alert | null = null;
    private readonly MAX_QUEUE_SIZE = 100;
    private readonly QUEUE_WARNING_THRESHOLD = 0.8; // 80%

    constructor(
        private readonly io: Server,
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private pluginManager: PluginManager | null = null
    ) {}

    public setPluginLoader(pluginManager: PluginManager): void {
        this.pluginManager = pluginManager;
    }

    public addAlert(type: string, data: any, customConfig: AlertConfig | null = null): void {
        try {
            let config = customConfig || (this.db as any).getAlertConfig(type);

            if (!config) {
                config = this.getDefaultConfig(type);
            }

            if (!config.enabled) {
                this.logger.debug(`Alert for ${type} is disabled`);
                return;
            }

            const renderedText = this.renderTemplate(config.text_template || '', data);
            let soundFile = config.sound_file;
            let soundVolume = config.sound_volume || 80;

            // Check if soundboard plugin should handle sound
            if (this.pluginManager) {
                // Simplified soundboard check for the sake of the migration
                // In a real scenario, this would be more detailed or handled via events
            }

            const alert: Alert = {
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
                this.logger.error(`Alert queue full, rejecting alert: ${type}`);
                this.io.emit('alert:queue-full', {
                    type,
                    queueSize: this.queue.length,
                    maxSize: this.MAX_QUEUE_SIZE
                });
                return;
            }

            if (this.queue.length >= this.MAX_QUEUE_SIZE * this.QUEUE_WARNING_THRESHOLD) {
                this.logger.warn(`Alert queue at ${this.queue.length}/${this.MAX_QUEUE_SIZE} capacity`);
            }

            this.queue.push(alert);
            this.logger.info(`[ALERT] Queued: ${type} - ${renderedText}`);
            this.processQueue();

        } catch (error: any) {
            this.logger.error(`Alert Error: ${error.message}`);
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

    private renderTemplate(template: string, data: any): string {
        if (!template) return this.getDefaultText(data);

        let rendered = template;
        const variables: Record<string, string> = {
            '{username}': data.username || data.uniqueId || data.nickname || 'Viewer',
            '{nickname}': data.nickname || data.username || data.uniqueId || 'Viewer',
            '{message}': data.message || '',
            '{gift_name}': data.giftName || '',
            '{coins}': String(data.coins || 0),
            '{repeat_count}': String(data.repeatCount || 1),
            '{like_count}': String(data.likeCount || 1),
            '{total_coins}': String(data.totalCoins || 0)
        };

        Object.entries(variables).forEach(([key, value]) => {
            rendered = rendered.replace(new RegExp(key, 'g'), value);
        });

        return rendered;
    }

    private getDefaultText(data: any): string {
        const username = data.username || data.uniqueId || data.nickname || 'Viewer';
        if (data.giftName) {
            return `${username} sent ${data.giftName}${data.repeatCount > 1 ? ' x' + data.repeatCount : ''}!`;
        } else if (data.message) {
            return `${username}: ${data.message}`;
        }
        return username;
    }

    private getDefaultConfig(type: string): AlertConfig {
        const defaults: Record<string, AlertConfig> = {
            gift: { event_type: 'gift', sound_file: null, sound_volume: 80, text_template: '{username} sent {gift_name} x{repeat_count}!', duration: 5, enabled: true },
            follow: { event_type: 'follow', sound_file: null, sound_volume: 80, text_template: '{username} followed!', duration: 4, enabled: true },
            subscribe: { event_type: 'subscribe', sound_file: null, sound_volume: 100, text_template: '{username} subscribed!', duration: 6, enabled: true },
            share: { event_type: 'share', sound_file: null, sound_volume: 80, text_template: '{username} shared!', duration: 4, enabled: true },
            like: { event_type: 'like', sound_file: null, sound_volume: 50, text_template: '{username} liked!', duration: 2, enabled: false }
        };
        return defaults[type] || { event_type: type, sound_file: null, sound_volume: 80, text_template: '{username}', duration: 5, enabled: true };
    }
}
