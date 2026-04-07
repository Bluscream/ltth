import { DatabaseService } from './DatabaseService';
import { ConfigPathManager } from './ConfigPathManager';
import { ILogger } from './LoggerService';
import { PluginLoader } from './PluginLoader';
import { PluginBackupProvider } from '../types/plugins';

// Converted TS files
import { exportBackup } from './backup/exporter';
import { parseBackupZip, previewImport, performImport, cleanupTempDir } from './backup/importer';

export class BackupManager {
    private readonly backupProviders = new Map<string, PluginBackupProvider>();
    private readonly appVersion: string;

    constructor(
        private readonly db: DatabaseService,
        private readonly configPathManager: ConfigPathManager,
        private readonly pluginLoader: PluginLoader,
        private readonly logger: ILogger,
        appVersion?: string
    ) {
        this.appVersion = appVersion || 'unknown';
    }

    public registerBackupProvider(pluginId: string, provider: PluginBackupProvider): void {
        this.backupProviders.set(pluginId, provider);
        this.logger.info(`[BackupManager] Registered provider for plugin: ${pluginId}`);
    }

    public unregisterBackupProvider(pluginId: string): void {
        if (this.backupProviders.delete(pluginId)) {
            this.logger.info(`[BackupManager] Unregistered provider for plugin: ${pluginId}`);
        }
    }

    public getBackupProvider(pluginId: string): PluginBackupProvider | null {
        return this.backupProviders.get(pluginId) || null;
    }

    public async export(opts: any = {}, activeProfile: string | null = null): Promise<{ stream: any; warnings: string[] }> {
        this.logger.info('[BackupManager] Starting configuration export');
        const result = await exportBackup(
            {
                db: this.db,
                configPathManager: this.configPathManager,
                pluginLoader: this.pluginLoader,
                backupProviders: Object.fromEntries(this.backupProviders),
                appVersion: this.appVersion,
                activeProfile
            },
            opts
        );

        result.warnings.forEach(w => this.logger.warn(`[BackupManager] Export warning: ${w}`));
        return result;
    }

    public async parseBackup(zipPath: string, fileSizeBytes?: number): Promise<any> {
        this.logger.info(`[BackupManager] Parsing backup archive: ${zipPath}`);
        return await parseBackupZip(zipPath, fileSizeBytes);
    }

    public async previewImport(parsed: any, opts: any = {}): Promise<any> {
        return previewImport(parsed, { db: this.db }, opts);
    }

    public async import(parsed: any, opts: any = {}): Promise<any> {
        this.logger.info('[BackupManager] Starting configuration import');
        try {
            return await performImport(
                parsed,
                {
                    db: this.db,
                    configPathManager: this.configPathManager,
                    backupProviders: Object.fromEntries(this.backupProviders)
                },
                opts
            );
        } finally {
            if (parsed.tmpDir) cleanupTempDir(parsed.tmpDir);
        }
    }

    public getCapabilities(): any {
        return {
            supportsExport: true,
            supportsImport: true,
            supportedSections: ['globalSettings', 'pluginSettings', 'pluginData', 'uploads', 'userdata'],
            supportedImportModes: ['merge', 'replace'],
            maxBackupSizeMb: 500
        };
    }
}
