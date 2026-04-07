import fs from 'fs/promises';
import path from 'path';
import { ILogger } from './LoggerService';
import { DatabaseService } from './DatabaseService';

export interface PresetMetadata {
    name: string;
    description: string;
    exportDate: string;
    version: string;
    author: string;
}

export interface PresetData {
    settings?: any;
    flows?: any[];
    alertConfigs?: any[];
    giftSounds?: any[];
    userVoices?: any[];
    pluginConfigs?: any;
}

export interface Preset {
    metadata: PresetMetadata;
    data: PresetData;
}

export interface PresetOptions {
    name?: string;
    description?: string;
    author?: string;
    includeSettings?: boolean;
    includeFlows?: boolean;
    includeAlerts?: boolean;
    includeGiftSounds?: boolean;
    includeVoiceMappings?: boolean;
    includePluginConfigs?: boolean;
}

export interface ImportOptions {
    overwrite?: boolean;
    createBackup?: boolean;
    includeSettings?: boolean;
    includeFlows?: boolean;
    includeAlerts?: boolean;
    includeGiftSounds?: boolean;
    includeVoiceMappings?: boolean;
    includePluginConfigs?: boolean;
}

export class PresetService {
    constructor(
        private readonly db: DatabaseService,
        private readonly logger: ILogger
    ) {}

    public async exportPreset(options: PresetOptions = {}): Promise<Preset> {
        try {
            const preset: Preset = {
                metadata: {
                    name: options.name || 'Unnamed Preset',
                    description: options.description || '',
                    exportDate: new Date().toISOString(),
                    version: '1.3.3', // TODO: Get from package.json dynamically
                    author: options.author || 'Unknown',
                },
                data: {},
            };

            if (options.includeSettings !== false) preset.data.settings = await this.exportSettings();
            if (options.includeFlows !== false) preset.data.flows = await this.exportFlows();
            if (options.includeAlerts !== false) preset.data.alertConfigs = await this.exportAlertConfigs();
            if (options.includeGiftSounds !== false) preset.data.giftSounds = await this.exportGiftSounds();
            if (options.includeVoiceMappings !== false) preset.data.userVoices = await this.exportUserVoices();
            if (options.includePluginConfigs !== false) preset.data.pluginConfigs = await this.exportPluginConfigs();

            this.logger.info(`Preset exported successfully: ${preset.metadata.name}`);
            return preset;
        } catch (error: any) {
            this.logger.error('Failed to export preset:', error);
            throw new Error('Failed to export preset: ' + error.message);
        }
    }

    public async importPreset(preset: Preset, options: ImportOptions = {}): Promise<any> {
        const result: any = { success: false, imported: {}, errors: {} };

        try {
            if (!preset.metadata || !preset.data) throw new Error('Invalid preset format');

            if (options.createBackup !== false) await this.createBackup();

            const importTasks = [
                { key: 'settings', data: preset.data.settings, opt: options.includeSettings, func: this.importSettings.bind(this) },
                { key: 'flows', data: preset.data.flows, opt: options.includeFlows, func: this.importFlows.bind(this) },
                { key: 'alertConfigs', data: preset.data.alertConfigs, opt: options.includeAlerts, func: this.importAlertConfigs.bind(this) },
                { key: 'giftSounds', data: preset.data.giftSounds, opt: options.includeGiftSounds, func: this.importGiftSounds.bind(this) },
                { key: 'userVoices', data: preset.data.userVoices, opt: options.includeVoiceMappings, func: this.importUserVoices.bind(this) },
                { key: 'pluginConfigs', data: preset.data.pluginConfigs, opt: options.includePluginConfigs, func: this.importPluginConfigs.bind(this) },
            ];

            for (const task of importTasks) {
                if (task.data && task.opt !== false) {
                    try {
                        await task.func(task.data, options.overwrite);
                        result.imported[task.key] = true;
                    } catch (error: any) {
                        result.errors[task.key] = error.message;
                    }
                }
            }

            result.success = Object.keys(result.imported).length > 0;
            this.logger.info('Preset imported', { imported: result.imported, errors: result.errors });
            return result;
        } catch (error: any) {
            this.logger.error('Failed to import preset:', error);
            throw new Error('Failed to import preset: ' + error.message);
        }
    }

    private async exportSettings(): Promise<Record<string, any>> {
        const rows = this.db.all('SELECT key, value FROM settings');
        const settings: Record<string, any> = {};
        rows.forEach((row: any) => {
            try { settings[row.key] = JSON.parse(row.value); }
            catch { settings[row.key] = row.value; }
        });
        return settings;
    }

    private async importSettings(settings: Record<string, any>, overwrite: boolean = false): Promise<void> {
        const upsert = this.db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);

        if (overwrite) {
            for (const [key, value] of Object.entries(settings)) {
                upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        } else {
            const existingKeys = this.db.all('SELECT key FROM settings').map((r: any) => r.key);
            for (const [key, value] of Object.entries(settings)) {
                if (!existingKeys.includes(key)) {
                    upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
                }
            }
        }
    }

    private async exportFlows(): Promise<any[]> {
        return this.db.all('SELECT * FROM flows');
    }

    private async importFlows(flows: any[], overwrite: boolean = false): Promise<void> {
        if (overwrite) this.db.run('DELETE FROM flows');
        const insert = this.db.prepare('INSERT INTO flows (name, trigger_type, trigger_condition, actions, enabled) VALUES (?, ?, ?, ?, ?)');
        flows.forEach(flow => insert.run(flow.name, flow.trigger_type, flow.trigger_condition, flow.actions, flow.enabled));
    }

    private async exportAlertConfigs(): Promise<any[]> {
        return this.db.all('SELECT * FROM alert_configs');
    }

    private async importAlertConfigs(configs: any[], overwrite: boolean = false): Promise<void> {
        if (overwrite) this.db.run('DELETE FROM alert_configs');
        const insert = this.db.prepare('INSERT OR REPLACE INTO alert_configs (event_type, enabled, text_template, sound_file, duration, image_url, animation_type) VALUES (?, ?, ?, ?, ?, ?, ?)');
        configs.forEach(c => insert.run(c.event_type, c.enabled, c.text_template, c.sound_file, c.duration, c.image_url, c.animation_type));
    }

    private async exportGiftSounds(): Promise<any[]> {
        return this.db.all('SELECT * FROM gift_sounds');
    }

    private async importGiftSounds(sounds: any[], overwrite: boolean = false): Promise<void> {
        if (overwrite) this.db.run('DELETE FROM gift_sounds');
        const insert = this.db.prepare('INSERT OR REPLACE INTO gift_sounds (gift_id, label, mp3_url, volume, animation_url, animation_type) VALUES (?, ?, ?, ?, ?, ?)');
        sounds.forEach(s => insert.run(s.gift_id, s.label, s.mp3_url, s.volume, s.animation_url, s.animation_type));
    }

    private async exportUserVoices(): Promise<any[]> {
        return this.db.all('SELECT * FROM user_voices');
    }

    private async importUserVoices(voices: any[], overwrite: boolean = false): Promise<void> {
        if (overwrite) this.db.run('DELETE FROM user_voices');
        const insert = this.db.prepare('INSERT OR REPLACE INTO user_voices (username, voice_id) VALUES (?, ?)');
        voices.forEach(v => insert.run(v.username, v.voice_id));
    }

    private async exportPluginConfigs(): Promise<Record<string, any>> {
        const rows = this.db.all("SELECT key, value FROM settings WHERE key LIKE 'plugin:%'");
        const configs: Record<string, any> = {};
        rows.forEach((row: any) => {
            try { configs[row.key] = JSON.parse(row.value); }
            catch { configs[row.key] = row.value; }
        });
        return configs;
    }

    private async importPluginConfigs(configs: Record<string, any>, _overwrite: boolean = false): Promise<void> {
        const upsert = this.db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        for (const [key, value] of Object.entries(configs)) {
            if (key.startsWith('plugin:')) {
                upsert.run(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        }
    }

    private async createBackup(): Promise<void> {
        try {
            const backupDir = path.join(__dirname, '..', 'user_data', 'preset_backups');
            await fs.mkdir(backupDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
            const backupPath = path.join(backupDir, `backup_${timestamp}.json`);
            const backup = await this.exportPreset({
                name: `Backup ${timestamp}`,
                description: 'Automatic backup before preset import',
                includeSettings: true, includeFlows: true, includeAlerts: true,
                includeGiftSounds: true, includeVoiceMappings: true, includePluginConfigs: true,
            });
            await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
            this.logger.info(`Backup created: ${backupPath}`);
        } catch (error: any) {
            this.logger.error('Failed to create backup:', error);
        }
    }

    public async savePresetToFile(preset: Preset, filePath: string): Promise<void> {
        await fs.writeFile(filePath, JSON.stringify(preset, null, 2));
    }

    public async loadPresetFromFile(filePath: string): Promise<Preset> {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    }
}
