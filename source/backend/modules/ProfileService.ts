import fs from 'fs';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { ConfigPathManager } from './ConfigPathManager';
import { DatabaseService } from './DatabaseService';

export interface UserProfile {
    username: string;
    path: string;
    created: Date;
    modified: Date;
    size: number;
}

export class ProfileService {
    private readonly configDir: string;
    private readonly activeProfilePath: string;

    constructor(private readonly configPathManager: ConfigPathManager) {
        this.configPathManager.ensureDirectoriesExist();
        
        this.configDir = this.configPathManager.getUserConfigsDir();
        this.activeProfilePath = path.join(this.configDir, '.active_profile');

        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }

    public getProfilePath(username: string): string {
        const sanitized = username.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.configDir, `${sanitized}.db`);
    }

    public listProfiles(): UserProfile[] {
        if (!fs.existsSync(this.configDir)) {
            return [];
        }

        const files = fs.readdirSync(this.configDir);
        return files
            .filter(file => file.endsWith('.db'))
            .map(file => {
                const username = file.replace('.db', '');
                const filePath = path.join(this.configDir, file);
                const stats = fs.statSync(filePath);

                return {
                    username,
                    path: filePath,
                    created: stats.birthtime,
                    modified: stats.mtime,
                    size: stats.size
                };
            })
            .sort((a, b) => b.modified.getTime() - a.modified.getTime());
    }

    public profileExists(username: string): boolean {
        const profilePath = this.getProfilePath(username);
        return fs.existsSync(profilePath);
    }

    public createProfile(username: string): any {
        const profilePath = this.getProfilePath(username);

        if (this.profileExists(username)) {
            throw new Error(`Profile "${username}" already exists`);
        }

        const db = new BetterSqlite3(profilePath);
        db.close();

        return {
            username,
            path: profilePath,
            created: new Date()
        };
    }

    public deleteProfile(username: string): boolean {
        const profilePath = this.getProfilePath(username);

        if (!this.profileExists(username)) {
            throw new Error(`Profile "${username}" does not exist`);
        }

        const activeProfile = this.getActiveProfile();
        if (activeProfile === username) {
            this.clearActiveProfile();
        }

        fs.unlinkSync(profilePath);

        const walPath = `${profilePath}-wal`;
        const shmPath = `${profilePath}-shm`;

        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

        return true;
    }

    public setActiveProfile(username: string): void {
        fs.writeFileSync(this.activeProfilePath, username, 'utf8');
    }

    public getActiveProfile(): string | null {
        if (!fs.existsSync(this.activeProfilePath)) {
            return null;
        }

        const username = fs.readFileSync(this.activeProfilePath, 'utf8').trim();

        if (!this.profileExists(username)) {
            this.clearActiveProfile();
            return null;
        }

        return username;
    }

    public clearActiveProfile(): void {
        if (fs.existsSync(this.activeProfilePath)) {
            fs.unlinkSync(this.activeProfilePath);
        }
    }

    public migrateOldDatabase(username: string): boolean {
        const oldDbPath = path.join(__dirname, '..', 'database.db');

        if (!fs.existsSync(oldDbPath)) {
            return false;
        }

        const newDbPath = this.getProfilePath(username);

        if (this.profileExists(username)) {
            throw new Error(`Cannot migrate: Profile "${username}" already exists`);
        }

        fs.copyFileSync(oldDbPath, newDbPath);

        const oldWalPath = `${oldDbPath}-wal`;
        const oldShmPath = `${oldDbPath}-shm`;

        if (fs.existsSync(oldWalPath)) fs.copyFileSync(oldWalPath, `${newDbPath}-wal`);
        if (fs.existsSync(oldShmPath)) fs.copyFileSync(oldShmPath, `${newDbPath}-shm`);

        return true;
    }

    public backupProfile(username: string): any {
        const profilePath = this.getProfilePath(username);

        if (!this.profileExists(username)) {
            throw new Error(`Profile "${username}" does not exist`);
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.configDir, `${username}_backup_${timestamp}.db`);

        fs.copyFileSync(profilePath, backupPath);

        return {
            username,
            backupPath,
            timestamp: new Date()
        };
    }

    public findProfileByUsername(username: string): string | null {
        const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();
        const profiles = this.listProfiles();

        for (const profile of profiles) {
            if (profile.username.toLowerCase() === cleanUsername) {
                return profile.username;
            }

            try {
                const profileDb = new BetterSqlite3(profile.path, { readonly: true });
                try {
                    const tableExists = profileDb.prepare(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='profile_username_aliases'"
                    ).get();

                    if (tableExists) {
                        const alias = profileDb.prepare(
                            'SELECT id FROM profile_username_aliases WHERE username = ? COLLATE NOCASE'
                        ).get(cleanUsername);
                        if (alias) {
                            return profile.username;
                        }
                    }
                } finally {
                    profileDb.close();
                }
            } catch (err) {
                // Ignore errors during individual profile checks
            }
        }

        return null;
    }
}
