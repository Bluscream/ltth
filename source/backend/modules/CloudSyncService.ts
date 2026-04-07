import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';
import { ConfigPathManager } from './ConfigPathManager';

export interface CloudSyncConfig {
    enabled: boolean;
    cloudPath: string | null;
    lastSyncTime?: Date | null;
    stats?: CloudSyncStats;
}

export interface CloudSyncStats {
    totalSyncs: number;
    successfulSyncs: number;
    failedSyncs: number;
    filesUploaded: number;
    filesDownloaded: number;
    conflicts: number;
}

export class CloudSyncService extends EventEmitter {
    private isEnabled = false;
    private syncInProgress = false;
    private cloudPath: string | null = null;
    private localPath: string;
    private watcher: fs.FSWatcher | null = null;
    private cloudWatcher: fs.FSWatcher | null = null;
    private syncStats: CloudSyncStats = {
        totalSyncs: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        filesUploaded: 0,
        filesDownloaded: 0,
        conflicts: 0
    };
    private lastSyncTime: Date | null = null;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private readonly debounceDelay = 1000;

    constructor(
        private readonly db: DatabaseService,
        private readonly logger: ILogger,
        private readonly configPathManager: ConfigPathManager
    ) {
        super();
        this.localPath = this.configPathManager.getUserConfigsDir();
        this.loadConfig();
    }

    private loadConfig(): void {
        try {
            const val = this.db.getSetting('cloud_sync:config');
            if (val) {
                // DatabaseService.getSetting already attempts to parse JSON, 
                // so val might already be an object.
                const config: CloudSyncConfig = typeof val === 'string' ? JSON.parse(val) : val;
                this.isEnabled = config.enabled || false;
                this.cloudPath = config.cloudPath || null;
                if (config.stats) this.syncStats = config.stats;
                if (config.lastSyncTime) this.lastSyncTime = new Date(config.lastSyncTime);
                this.logger.info(`[CloudSync] Configuration loaded: enabled=${this.isEnabled}, cloudPath=${this.cloudPath || 'not set'}`);
            } else {
                this.saveConfig();
                this.logger.info('[CloudSync] Initialized with default configuration (disabled)');
            }
        } catch (error: any) {
            this.logger.error(`[CloudSync] Failed to load config: ${error.message}`);
        }
    }

    private saveConfig(): void {
        try {
            const config: CloudSyncConfig = {
                enabled: this.isEnabled,
                cloudPath: this.cloudPath,
                lastSyncTime: this.lastSyncTime,
                stats: this.syncStats
            };
            this.db.setSetting('cloud_sync:config', JSON.stringify(config));
        } catch (error: any) {
            this.logger.error(`[CloudSync] Failed to save config: ${error.message}`);
        }
    }

    public async initialize(): Promise<void> {
        if (this.isEnabled && this.cloudPath) {
            if (this.validateCloudPath(this.cloudPath).valid) {
                await this.performInitialSync();
                this.startWatchers();
            } else {
                this.isEnabled = false;
                this.saveConfig();
            }
        }
    }

    public validateCloudPath(cloudPath: string): { valid: boolean; error?: string } {
        if (!cloudPath) return { valid: false, error: 'Cloud path is required' };
        if (!fs.existsSync(cloudPath)) return { valid: false, error: 'Path does not exist' };
        if (!fs.statSync(cloudPath).isDirectory()) return { valid: false, error: 'Path is not a directory' };
        try {
            const testFile = path.join(cloudPath, '.cloud_sync_test');
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
            return { valid: true };
        } catch (error) {
            return { valid: false, error: 'Path is not writable' };
        }
    }

    public async enable(cloudPath: string): Promise<boolean> {
        const validation = this.validateCloudPath(cloudPath);
        if (!validation.valid) throw new Error(validation.error);

        this.cloudPath = cloudPath;
        this.isEnabled = true;
        this.saveConfig();
        await this.performInitialSync();
        this.startWatchers();
        this.emit('enabled', { cloudPath });
        return true;
    }

    public async disable(): Promise<void> {
        this.stopWatchers();
        this.isEnabled = false;
        this.saveConfig();
        this.emit('disabled');
    }

    private async performInitialSync(): Promise<void> {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        try {
            if (!this.cloudPath) return;
            if (!fs.existsSync(this.cloudPath)) fs.mkdirSync(this.cloudPath, { recursive: true });

            const localFiles = this.getAllFiles(this.localPath);
            const cloudFiles = this.getAllFiles(this.cloudPath);
            const allFiles = new Set([...localFiles, ...cloudFiles]);

            for (const file of allFiles) {
                const lp = path.join(this.localPath, file);
                const cp = path.join(this.cloudPath!, file);

                const le = fs.existsSync(lp);
                const ce = fs.existsSync(cp);

                if (le && !ce) {
                    await this.copyFile(lp, cp);
                    this.syncStats.filesUploaded++;
                } else if (!le && ce) {
                    await this.copyFile(cp, lp);
                    this.syncStats.filesDownloaded++;
                } else if (le && ce) {
                    const ls = fs.statSync(lp);
                    const cs = fs.statSync(cp);
                    if (ls.mtime > cs.mtime) {
                        await this.copyFile(lp, cp);
                        this.syncStats.filesUploaded++;
                        this.syncStats.conflicts++;
                    } else if (cs.mtime > ls.mtime) {
                        await this.copyFile(cp, lp);
                        this.syncStats.filesDownloaded++;
                        this.syncStats.conflicts++;
                    }
                }
            }
            this.lastSyncTime = new Date();
            this.syncStats.totalSyncs++;
            this.syncStats.successfulSyncs++;
            this.saveConfig();
            this.emit('syncComplete', this.syncStats);
        } catch (error: any) {
            this.syncStats.failedSyncs++;
            this.emit('syncError', error);
            throw error;
        } finally {
            this.syncInProgress = false;
        }
    }

    private getAllFiles(dir: string, arrayOfFiles: string[] = [], base?: string): string[] {
        if (!fs.existsSync(dir)) return arrayOfFiles;
        const currentBase = base || dir;
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            if (entry.startsWith('.')) continue;
            const fullPath = path.join(dir, entry);
            if (fs.statSync(fullPath).isDirectory()) {
                this.getAllFiles(fullPath, arrayOfFiles, currentBase);
            } else {
                arrayOfFiles.push(path.relative(currentBase, fullPath));
            }
        }
        return arrayOfFiles;
    }

    private async copyFile(src: string, dest: string): Promise<boolean> {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const data = fs.readFileSync(src);
        const tmp = dest + '.tmp';
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, dest);
        const stat = fs.statSync(src);
        fs.utimesSync(dest, stat.atime, stat.mtime);
        return true;
    }

    private startWatchers(): void {
        if (!this.isEnabled || !this.cloudPath) return;
        this.watcher = fs.watch(this.localPath, { recursive: true }, (evt, file) => {
            if (file && !file.startsWith('.')) this.handleLocalChange(evt, file);
        });
        this.cloudWatcher = fs.watch(this.cloudPath, { recursive: true }, (evt, file) => {
            if (file && !file.startsWith('.')) this.handleCloudChange(evt, file);
        });
    }

    private stopWatchers(): void {
        if (this.watcher) { this.watcher.close(); this.watcher = null; }
        if (this.cloudWatcher) { this.cloudWatcher.close(); this.cloudWatcher = null; }
        this.debounceTimers.forEach(t => clearTimeout(t));
        this.debounceTimers.clear();
    }

    private handleLocalChange(evt: string, file: string): void {
        this.debounceChange('local', file, async () => {
            const lp = path.join(this.localPath, file);
            const cp = path.join(this.cloudPath!, file);
            if (fs.existsSync(lp)) {
                const ls = fs.statSync(lp);
                if (!fs.existsSync(cp) || ls.mtime > fs.statSync(cp).mtime) {
                    await this.copyFile(lp, cp);
                    this.syncStats.filesUploaded++;
                    this.emit('fileUploaded', { file });
                }
            } else if (fs.existsSync(cp)) {
                fs.unlinkSync(cp);
                this.emit('fileDeleted', { file, location: 'cloud' });
            }
        });
    }

    private handleCloudChange(evt: string, file: string): void {
        this.debounceChange('cloud', file, async () => {
            const lp = path.join(this.localPath, file);
            const cp = path.join(this.cloudPath!, file);
            if (fs.existsSync(cp)) {
                const cs = fs.statSync(cp);
                if (!fs.existsSync(lp) || cs.mtime > fs.statSync(lp).mtime) {
                    await this.copyFile(cp, lp);
                    this.syncStats.filesDownloaded++;
                    this.emit('fileDownloaded', { file });
                }
            } else if (fs.existsSync(lp)) {
                fs.unlinkSync(lp);
                this.emit('fileDeleted', { file, location: 'local' });
            }
        });
    }

    private debounceChange(side: string, file: string, task: () => Promise<void>): void {
        const key = `${side}:${file}`;
        if (this.debounceTimers.has(key)) clearTimeout(this.debounceTimers.get(key)!);
        this.debounceTimers.set(key, setTimeout(async () => {
            this.debounceTimers.delete(key);
            try { await task(); } catch (e: any) { this.emit('syncError', { file, error: e.message }); }
        }, this.debounceDelay));
    }

    public getStatus(): any {
        return {
            enabled: this.isEnabled,
            cloudPath: this.cloudPath,
            syncInProgress: this.syncInProgress,
            lastSyncTime: this.lastSyncTime,
            stats: this.syncStats,
            watchers: { local: !!this.watcher, cloud: !!this.cloudWatcher }
        };
    }

    public async manualSync(): Promise<any> {
        if (!this.isEnabled) throw new Error('Cloud sync not enabled');
        await this.performInitialSync();
        return this.getStatus();
    }
}
