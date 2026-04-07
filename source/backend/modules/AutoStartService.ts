import AutoLaunch from 'auto-launch';
import path from 'path';
import { ILogger } from './LoggerService';

export interface PlatformInfo {
    platform: string;
    name: string;
    method: string;
    location?: string;
}

export interface AutoStartStatus {
    enabled: boolean;
    hidden: boolean;
    platform: string;
    supported: boolean;
    appPath: string | null;
}

export class AutoStartService {
    private autoLauncher: any = null;
    private isInitialized: boolean = false;

    constructor(private readonly logger: ILogger) {
        this.initializeAutoLauncher();
    }

    private initializeAutoLauncher(): void {
        try {
            const appName = 'TikTokStreamTool';
            const isPkg = (process as any).pkg;

            if (isPkg) {
                this.autoLauncher = new AutoLaunch({
                    name: appName,
                    path: process.execPath,
                    isHidden: false,
                });
            } else {
                this.autoLauncher = new AutoLaunch({
                    name: appName,
                    path: process.execPath,
                    args: [path.join(__dirname, '..', 'launch.js')],
                    isHidden: false,
                });
            }

            this.isInitialized = true;
            this.logger.info('AutoStartService initialized successfully');
        } catch (error: any) {
            this.logger.error('Failed to initialize AutoStartService:', error);
            this.isInitialized = false;
        }
    }

    public async enable(hidden: boolean = false): Promise<boolean> {
        if (!this.isInitialized) {
            this.logger.error('AutoStartService not initialized');
            return false;
        }

        try {
            const isEnabled = await this.isEnabled();

            if (isEnabled) {
                await this.disable();
            }

            if (hidden !== this.autoLauncher.opts.isHidden) {
                this.autoLauncher.opts.isHidden = hidden;
            }

            await this.autoLauncher.enable();
            this.logger.info(`Auto-start enabled (hidden: ${hidden})`);
            return true;
        } catch (error: any) {
            this.logger.error('Failed to enable auto-start:', error);
            return false;
        }
    }

    public async disable(): Promise<boolean> {
        if (!this.isInitialized) {
            this.logger.error('AutoStartService not initialized');
            return false;
        }

        try {
            const isEnabled = await this.isEnabled();

            if (!isEnabled) {
                this.logger.info('Auto-start already disabled');
                return true;
            }

            await this.autoLauncher.disable();
            this.logger.info('Auto-start disabled');
            return true;
        } catch (error: any) {
            this.logger.error('Failed to disable auto-start:', error);
            return false;
        }
    }

    public async isEnabled(): Promise<boolean> {
        if (!this.isInitialized) {
            return false;
        }

        try {
            return await this.autoLauncher.isEnabled();
        } catch (error: any) {
            this.logger.error('Failed to check auto-start status:', error);
            return false;
        }
    }

    public async getStatus(): Promise<AutoStartStatus> {
        const enabled = await this.isEnabled();

        return {
            enabled,
            hidden: this.autoLauncher?.opts?.isHidden || false,
            platform: process.platform,
            supported: this.isInitialized,
            appPath: this.autoLauncher?.opts?.path || null,
        };
    }

    public async toggle(enabled: boolean, hidden: boolean = false): Promise<boolean> {
        if (enabled) {
            return await this.enable(hidden);
        } else {
            return await this.disable();
        }
    }

    public isSupported(): boolean {
        const supportedPlatforms = ['win32', 'darwin', 'linux'];
        return supportedPlatforms.includes(process.platform) && this.isInitialized;
    }

    public getPlatformInfo(): PlatformInfo {
        const platform = process.platform;
        let info: PlatformInfo = {
            platform,
            name: 'Unknown',
            method: 'Unknown',
        };

        switch (platform) {
            case 'win32':
                info.name = 'Windows';
                info.method = 'Registry (Run key)';
                info.location = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
                break;
            case 'darwin':
                info.name = 'macOS';
                info.method = 'Login Items';
                info.location = '~/Library/LaunchAgents';
                break;
            case 'linux':
                info.name = 'Linux';
                info.method = 'Desktop Entry';
                info.location = '~/.config/autostart';
                break;
        }

        return info;
    }
}
