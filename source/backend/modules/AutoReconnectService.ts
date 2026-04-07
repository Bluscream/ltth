import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export class AutoReconnectService {
    constructor(
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private readonly tiktok: any,
        private readonly obs: any
    ) {}

    public async reconnectAll(): Promise<void> {
        await this.reconnectOBS();
        await this.reconnectTikTok();
    }

    private async reconnectOBS(): Promise<void> {
        const obsConfigStr = this.db.getSetting('obs_websocket_config');
        if (!obsConfigStr) return;

        try {
            const obsConfig = JSON.parse(obsConfigStr);
            if (obsConfig.enabled && obsConfig.host && obsConfig.port) {
                this.logger.info(`🎬 Connecting to OBS at ${obsConfig.host}:${obsConfig.port}...`);
                try {
                    await this.obs.connect(obsConfig.host, obsConfig.port, obsConfig.password);
                    this.logger.info('✅ OBS connected successfully');
                } catch (error: any) {
                    this.logger.warn(`⚠️  Could not connect to OBS: ${error.message}`);
                }
            }
        } catch (error: any) {
            this.logger.warn(`⚠️  Failed to parse OBS config: ${error.message}`);
        }
    }

    private async reconnectTikTok(): Promise<void> {
        const autoReconnectEnabled = this.db.getSetting('tiktok_auto_reconnect') !== 'false';
        const savedUsername = this.db.getSetting('last_connected_username');

        if (!savedUsername) return;

        if (autoReconnectEnabled) {
            this.logger.info(`🔄 Auto-Reconnect enabled: Attempting connection to @${savedUsername}...`);
            // Delay connection slightly to ensure server is fully ready
            setTimeout(async () => {
                try {
                    await this.tiktok.connect(savedUsername);
                    this.logger.info(`✅ Automatically connected to @${savedUsername}`);
                } catch (error: any) {
                    this.logger.warn(`⚠️  Auto-Reconnect failed for @${savedUsername}: ${error.message}`);
                    this.logger.info('   This is expected if the stream is offline.');
                }
            }, 2000);
        } else {
            this.logger.info(`ℹ️  Auto-Reconnect disabled. Last stream: @${savedUsername}`);
            this.updateGiftCatalog(savedUsername);
        }
    }

    private updateGiftCatalog(username: string): void {
        this.logger.info(`🎁 Updating gift catalog for @${username}...`);
        setTimeout(async () => {
            try {
                const result = await this.tiktok.updateGiftCatalog({
                    preferConnected: true,
                    username: username
                });
                if (result.ok) {
                    this.logger.info(`✅ ${result.message}`);
                } else {
                    this.logger.info(`ℹ️  Gift catalog update: ${result.message}`);
                }
            } catch (error: any) {
                this.logger.warn(`⚠️  Failed to update gift catalog automatically: ${error.message}`);
            }
        }, 3000);
    }
}
