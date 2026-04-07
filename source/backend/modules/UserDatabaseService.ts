import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface LTTHUser {
    id: number;
    username: string;
    display_name: string;
    avatar?: string;
    language: string;
    created_at: string;
    last_login?: string;
    is_active: boolean;
    profiles?: LTTHProfile[];
}

export interface LTTHProfile {
    id: number;
    user_id: number;
    name: string;
    config_path: string;
    is_default: boolean;
    created_at: string;
    last_used?: string;
}

/**
 * User Database Service - Manages multi-user system with its own SQLite database
 */
export class UserDatabaseService {
    private db: Database.Database;
    private dbPath: string;

    constructor(dbPath?: string) {
        this.dbPath = dbPath || this.getDefaultDbPath();
        
        // Ensure directory exists
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        try {
            this.db = new Database(this.dbPath);
            this.initializeTables();
            console.log(`[UserDatabase] Initialized at: ${this.dbPath}`);
        } catch (error) {
            console.error(`[UserDatabase] Failed to initialize:`, error);
            throw error;
        }
    }

    private getDefaultDbPath(): string {
        const homeDir = os.homedir();
        let configDir: string;
        
        switch (process.platform) {
            case 'win32':
                configDir = path.join(process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'pupcidslittletiktokhelper');
                break;
            case 'darwin':
                configDir = path.join(homeDir, 'Library', 'Application Support', 'pupcidslittletiktokhelper');
                break;
            default:
                configDir = path.join(homeDir, '.local', 'share', 'pupcidslittletiktokhelper');
        }
        
        return path.join(configDir, 'users.db');
    }

    private initializeTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                avatar TEXT,
                language TEXT DEFAULT 'de',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                is_active INTEGER DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                config_path TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, name)
            );

            CREATE TABLE IF NOT EXISTS profile_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profile_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
                UNIQUE(profile_id, key)
            );

            CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);
    }

    public getAllUsers(): LTTHUser[] {
        const stmt = this.db.prepare(`
            SELECT u.* FROM users u WHERE u.is_active = 1 ORDER BY u.last_login DESC NULLS LAST
        `);
        const users = stmt.all() as any[];
        return users.map(user => ({
            ...user,
            is_active: Boolean(user.is_active),
            profiles: this.getUserProfiles(user.username)
        }));
    }

    public getUser(username: string): LTTHUser | null {
        const stmt = this.db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1');
        const user = stmt.get(username) as any;
        if (!user) return null;
        
        return {
            ...user,
            is_active: Boolean(user.is_active),
            profiles: this.getUserProfiles(username)
        };
    }

    public getUserProfiles(username: string): LTTHProfile[] {
        const user = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
        if (!user) return [];
        
        const stmt = this.db.prepare(`
            SELECT * FROM profiles WHERE user_id = ? ORDER BY is_default DESC, last_used DESC NULLS LAST
        `);
        const profiles = stmt.all(user.id) as any[];
        return profiles.map(p => ({
            ...p,
            is_default: Boolean(p.is_default)
        }));
    }

    public createUser(username: string, language: string = 'de', avatarUrl?: string, displayName?: string): LTTHUser {
        username = username.replace(/^@/, '');
        
        const userId = this.db.transaction(() => {
            const result = this.db.prepare(`
                INSERT INTO users (username, display_name, avatar, language, last_login)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(username, displayName || username, avatarUrl || null, language);
            
            const id = result.lastInsertRowid;
            const userDir = this.getUserDirectory(username);
            const profileDir = path.join(userDir, 'profiles', 'default');
            fs.mkdirSync(profileDir, { recursive: true });
            
            this.db.prepare(`
                INSERT INTO profiles (user_id, name, config_path, is_default, last_used)
                VALUES (?, 'default', ?, 1, CURRENT_TIMESTAMP)
            `).run(id, profileDir);
            
            return id;
        })();
        
        return this.getUser(username)!;
    }

    public deleteUser(username: string): boolean {
        const user = this.getUser(username);
        if (!user) return false;
        
        this.db.transaction(() => {
            this.db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
            const userDir = this.getUserDirectory(username);
            if (fs.existsSync(userDir)) {
                fs.rmSync(userDir, { recursive: true, force: true });
            }
        })();
        
        return true;
    }

    public getUserDirectory(username: string): string {
        const configDir = path.dirname(this.dbPath);
        return path.join(configDir, 'users', username);
    }

    public close(): void {
        this.db.close();
    }
}
