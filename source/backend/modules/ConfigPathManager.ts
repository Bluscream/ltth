import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * ConfigPathManager - Manages persistent storage location for user configurations
 */
export class ConfigPathManager {
    private readonly APP_NAME = 'pupcidslittletiktokhelper';
    private customConfigPath: string | null = null;
    private settingsFile: string;

    constructor() {
        const appDir = path.join(__dirname, '..');
        this.settingsFile = path.join(appDir, '.config_path');
        
        this.initializeBootstrapSettings();
        
        const configDir = this.getConfigDir();
        console.log(`📂 [ConfigPathManager] Settings stored at: ${configDir}`);
    }

    private initializeBootstrapSettings() {
        if (fs.existsSync(this.settingsFile)) {
            try {
                const data = fs.readFileSync(this.settingsFile, 'utf8').trim();
                if (data && fs.existsSync(data) && fs.statSync(data).isDirectory()) {
                    // Test write
                    const testFile = path.join(data, '.write_test');
                    fs.writeFileSync(testFile, 'test');
                    fs.unlinkSync(testFile);
                    this.customConfigPath = data;
                }
            } catch (error: any) {
                console.warn(`Warning: Could not initialize custom config path: ${error.message}`);
            }
        }
    }

    public getDefaultConfigDir(): string {
        const platform = os.platform();
        const homeDir = os.homedir();

        switch (platform) {
            case 'win32':
                return path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), this.APP_NAME);
            case 'darwin':
                return path.join(homeDir, 'Library', 'Application Support', this.APP_NAME);
            case 'linux':
            default:
                return path.join(homeDir, '.local', 'share', this.APP_NAME);
        }
    }

    public getConfigDir(): string {
        return this.customConfigPath || this.getDefaultConfigDir();
    }

    public getUserConfigsDir(): string {
        return path.join(this.getConfigDir(), 'user_configs');
    }

    public getUserDataDir(): string {
        return path.join(this.getConfigDir(), 'user_data');
    }

    public getUploadsDir(): string {
        return path.join(this.getConfigDir(), 'uploads');
    }

    public getPluginDataDir(pluginId: string): string {
        return path.join(this.getConfigDir(), 'plugins', pluginId, 'data');
    }

    public ensureDirectoriesExist() {
        const dirs = [
            this.getConfigDir(),
            this.getUserConfigsDir(),
            this.getUserDataDir(),
            this.getUploadsDir(),
            path.join(this.getUploadsDir(), 'animations')
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    public getInfo() {
        return {
            platform: os.platform(),
            activeConfigDir: this.getConfigDir(),
            isUsingCustomPath: this.customConfigPath !== null,
            surviveUpdates: true
        };
    }
}
