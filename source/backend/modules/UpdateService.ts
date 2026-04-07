import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { ILogger } from './LoggerService';

const execAsync = promisify(exec);

export interface UpdateInfo {
    available: boolean;
    currentVersion: string;
    latestVersion: string;
    releaseUrl?: string;
    releaseName?: string;
    releaseNotes?: string;
    publishedAt?: string;
    downloadUrl?: string;
    tarballUrl?: string;
    installerUrl?: string;
    updateMethod: 'git' | 'zip';
    updateCommand: string;
    success?: boolean;
    error?: string;
}

export class UpdateService {
    private readonly githubRepo = 'Loggableim/pupcidslittletiktokhelper';
    private readonly projectRoot = path.join(__dirname, '..');
    private readonly backupDir = path.join(this.projectRoot, '.backups');
    private readonly installerBaseUrl = 'https://ltth.app/downloads';
    private checkInterval: NodeJS.Timeout | null = null;
    public readonly currentVersion: string;
    public readonly isGitRepo: boolean;

    constructor(private readonly logger: ILogger) {
        this.currentVersion = this.getCurrentVersionFromPackage();
        this.isGitRepo = this.checkIsGitRepo();
    }

    private getCurrentVersionFromPackage(): string {
        try {
            const packagePath = path.join(this.projectRoot, 'package.json');
            const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            return packageData.version || '0.0.0';
        } catch (error: any) {
            this.logger.warn(`Could not read current version: ${error.message}`);
            return '0.0.0';
        }
    }

    private checkIsGitRepo(): boolean {
        return fs.existsSync(path.join(this.projectRoot, '.git'));
    }

    public getInstallerUrl(version: string): string {
        return `${this.installerBaseUrl}/ltthsetup${version}`;
    }

    public async checkForUpdates(): Promise<UpdateInfo> {
        try {
            const url = `https://api.github.com/repos/${this.githubRepo}/releases/latest`;
            this.logger.info('Checking for updates...');

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'PupCids-TikTok-Helper',
                    'Accept': 'application/vnd.github.v3+json'
                },
                timeout: 10000
            });

            const release = response.data;
            const latestVersion = release.tag_name.replace(/^v/, '');
            const isNewVersion = this.compareVersions(latestVersion, this.currentVersion) > 0;

            const updateInfo: UpdateInfo = {
                available: isNewVersion,
                currentVersion: this.currentVersion,
                latestVersion: latestVersion,
                releaseUrl: release.html_url,
                releaseName: release.name,
                releaseNotes: release.body,
                publishedAt: release.published_at,
                downloadUrl: release.zipball_url,
                tarballUrl: release.tarball_url,
                installerUrl: this.getInstallerUrl(latestVersion),
                updateMethod: this.isGitRepo ? 'git' : 'zip',
                updateCommand: this.isGitRepo ? 'git pull' : 'download-zip',
                success: true
            };

            if (isNewVersion) {
                this.logger.info(`New version available: ${latestVersion} (current: ${this.currentVersion})`);
            } else {
                this.logger.info(`Already up to date: ${this.currentVersion}`);
            }

            return updateInfo;
        } catch (error: any) {
            if (error.response?.status === 404) {
                this.logger.info(`No releases found for ${this.githubRepo}`);
                return {
                    success: false,
                    error: 'No releases available',
                    currentVersion: this.currentVersion,
                    available: false,
                    latestVersion: '0.0.0',
                    updateMethod: this.isGitRepo ? 'git' : 'zip',
                    updateCommand: ''
                };
            }

            this.logger.warn(`Update check failed: ${error.message}`);
            return {
                success: false,
                error: error.message,
                currentVersion: this.currentVersion,
                available: false,
                latestVersion: '0.0.0',
                updateMethod: this.isGitRepo ? 'git' : 'zip',
                updateCommand: ''
            };
        }
    }

    private compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(n => parseInt(n) || 0);
        const parts2 = v2.split('.').map(n => parseInt(n) || 0);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }

    public async createBackup(): Promise<{ success: boolean; backupPath?: string; error?: string }> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupPath = path.join(this.backupDir, `backup_${timestamp}`);

        this.logger.info(`Creating backup in: ${backupPath}`);

        try {
            if (!fs.existsSync(this.backupDir)) {
                fs.mkdirSync(this.backupDir, { recursive: true });
            }
            fs.mkdirSync(backupPath, { recursive: true });

            const pathsToBackup = ['user_data', 'user_configs', 'package.json', 'package-lock.json'];
            for (const item of pathsToBackup) {
                const srcPath = path.join(this.projectRoot, item);
                if (fs.existsSync(srcPath)) {
                    const destPath = path.join(backupPath, item);
                    if (fs.statSync(srcPath).isDirectory()) {
                        this.copyRecursive(srcPath, destPath);
                    } else {
                        fs.copyFileSync(srcPath, destPath);
                    }
                    this.logger.info(`${item} backed up`);
                }
            }

            return { success: true, backupPath };
        } catch (error: any) {
            this.logger.error(`Backup failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    private copyRecursive(src: string, dest: string): void {
        if (!fs.existsSync(src)) return;

        if (fs.statSync(src).isDirectory()) {
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            fs.readdirSync(src).forEach(entry => {
                this.copyRecursive(path.join(src, entry), path.join(dest, entry));
            });
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    public async performUpdate(): Promise<{ success: boolean; message?: string; error?: string; items?: any }> {
        try {
            this.logger.info('Step 1: Creating backup...');
            const backupResult = await this.createBackup();
            if (!backupResult.success || !backupResult.backupPath) {
                throw new Error(backupResult.error || 'Backup failed');
            }

            const backupPath = backupResult.backupPath;

            try {
                this.logger.info('Step 2: Downloading update...');
                let result;
                if (this.isGitRepo) {
                    result = await this.updateViaGit();
                } else {
                    result = await this.updateViaZip();
                }

                if (!result.success) throw new Error(result.error || 'Update failed');

                if (result.needsDependencyUpdate) {
                    this.logger.info('Step 3: Updating dependencies...');
                    await this.updateDependencies();
                }

                return { success: true, message: 'Update successful', items: { needsRestart: true, backupPath } };
            } catch (updateError: any) {
                this.logger.error(`Update failed: ${updateError.message}. Rolling back...`);
                await this.performRollback(backupPath);
                return { success: false, error: updateError.message, items: { rolledBack: true } };
            }
        } catch (error: any) {
            this.logger.error(`Update failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    private async updateViaGit(): Promise<{ success: boolean; needsDependencyUpdate?: boolean; error?: string }> {
        try {
            execSync('git --version', { stdio: 'ignore' });
            const status = execSync('git status --porcelain', { cwd: this.projectRoot, encoding: 'utf8' }).trim();

            if (status) {
                this.logger.warn('Local changes found. Stashing...');
                execSync('git stash save "Auto-stash before update"', { cwd: this.projectRoot });
            }

            const { stdout } = await execAsync('git pull', { cwd: this.projectRoot });
            const needsDependencyUpdate = stdout.includes('package.json') || stdout.includes('package-lock.json');

            return { success: true, needsDependencyUpdate };
        } catch (error: any) {
            return { success: false, error: `Git update failed: ${error.message}` };
        }
    }

    private async updateViaZip(): Promise<{ success: boolean; needsDependencyUpdate?: boolean; error?: string }> {
        // Zip implementation details (requires axios, zip-lib)
        // For brevity in this refactor, I'll keep the logic but expect 'zip-lib' to be available
        const zipPath = path.join(this.projectRoot, 'update.zip');
        const tempDir = path.join(this.projectRoot, '.update-temp');

        try {
            const updateInfo = await this.checkForUpdates();
            if (!updateInfo.downloadUrl) throw new Error('Download URL not found');

            const zipResponse = await axios.get(updateInfo.downloadUrl, {
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'PupCids-TikTok-Helper' },
                timeout: 120000
            });

            fs.writeFileSync(zipPath, Buffer.from(zipResponse.data));

            // Dynamically import zip-lib if possible, or expect it in node_modules
            const zl = require('zip-lib');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const unzip = new zl.Unzip();
            await unzip.extract(zipPath, tempDir);

            const entries = fs.readdirSync(tempDir);
            const extractedDir = entries.find(e => fs.statSync(path.join(tempDir, e)).isDirectory());
            if (!extractedDir) throw new Error('Extracted folder not found');

            const sourceDir = path.join(tempDir, extractedDir);
            const excludes = ['user_data', 'user_configs', 'node_modules', '.git', '.backups', '.update-temp'];

            fs.readdirSync(sourceDir).forEach(entry => {
                if (excludes.includes(entry)) return;
                const src = path.join(sourceDir, entry);
                const dest = path.join(this.projectRoot, entry);
                if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                this.copyRecursive(src, dest);
            });

            fs.rmSync(zipPath, { force: true });
            fs.rmSync(tempDir, { recursive: true, force: true });

            return { success: true, needsDependencyUpdate: true };
        } catch (error: any) {
            return { success: false, error: `ZIP update failed: ${error.message}` };
        }
    }

    private async updateDependencies(): Promise<void> {
        const lockPath = path.join(this.projectRoot, 'package-lock.json');
        let useCI = false;

        if (fs.existsSync(lockPath)) {
            try {
                const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
                useCI = lock.lockfileVersion >= 1;
            } catch {
                useCI = false;
            }
        }

        const cmd = useCI ? 'npm ci' : 'npm install';
        try {
            execSync(cmd, {
                cwd: this.projectRoot,
                stdio: 'inherit',
                env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true', YOUTUBE_DL_SKIP_PYTHON_CHECK: '1' }
            });
        } catch (error: any) {
            if (useCI) {
                this.logger.warn('npm ci failed, falling back to npm install...');
                execSync('npm install', { cwd: this.projectRoot });
            } else throw error;
        }
    }

    private async performRollback(backupPath: string): Promise<void> {
        try {
            ['user_data', 'user_configs', 'package.json', 'package-lock.json'].forEach(item => {
                const src = path.join(backupPath, item);
                if (fs.existsSync(src)) {
                    const dest = path.join(this.projectRoot, item);
                    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                    if (fs.statSync(src).isDirectory()) this.copyRecursive(src, dest);
                    else fs.copyFileSync(src, dest);
                }
            });
            this.logger.info('Rollback successful');
        } catch (error: any) {
            this.logger.error(`Rollback failed: ${error.message}`);
        }
    }

    public startAutoCheck(intervalHours: number = 24): void {
        this.stopAutoCheck();
        const ms = intervalHours * 60 * 60 * 1000;
        this.checkForUpdates();
        this.checkInterval = setInterval(() => this.checkForUpdates(), ms);
    }

    public stopAutoCheck(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}
