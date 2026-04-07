import Database from 'better-sqlite3';
import fs from 'fs';
import { ILogger } from './LoggerService';

/**
 * DatabaseService - Typed wrapper for SQLite database operations
 */
export class DatabaseService {
    private static instance: DatabaseService;
    private db!: Database.Database;
    private dbPath!: string;
    private streamerId: string | null = null;
    private logger: ILogger;

    private constructor() {
        this.logger = console;
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public connect(dbPath: string, streamerId: string | null = null, logger?: ILogger): void {
        this.dbPath = dbPath;
        this.streamerId = streamerId;
        if (logger) this.logger = logger;

        try {
            if (this.db) this.db.close();
            this.db = new Database(dbPath);
            this.db.pragma('integrity_check');
            this.db.pragma('journal_mode = WAL');
        } catch (error: any) {
            if (error.message?.includes('malformed') || error.message?.includes('corrupt')) {
                this.handleCorruptedDatabase(dbPath);
                this.db = new Database(dbPath);
            } else {
                throw error;
            }
        }

        this.initializeTables();
    }

    private handleCorruptedDatabase(dbPath: string) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = dbPath.replace(/\.db$/, `.corrupted.${timestamp}.db`);
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            fs.unlinkSync(dbPath);
        }
    }

    private initializeTables() {
        const schema = [
            `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
            `CREATE TABLE IF NOT EXISTS profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, config TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS flows (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, trigger_type TEXT NOT NULL, trigger_condition TEXT, actions TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS event_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, username TEXT, data TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS gift_catalog (id INTEGER PRIMARY KEY, name TEXT NOT NULL, image_url TEXT, diamond_count INTEGER DEFAULT 0, last_updated DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            `CREATE TABLE IF NOT EXISTS stream_stats (id INTEGER PRIMARY KEY CHECK (id = 1), viewers INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, total_coins INTEGER DEFAULT 0, followers INTEGER DEFAULT 0, shares INTEGER DEFAULT 0, gifts INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            // VDO.Ninja Rooms
            `CREATE TABLE IF NOT EXISTS vdoninja_rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_name TEXT UNIQUE NOT NULL,
                room_id TEXT UNIQUE NOT NULL,
                password TEXT,
                max_guests INTEGER DEFAULT 6,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used DATETIME
            )`,
            // VDO.Ninja Guests
            `CREATE TABLE IF NOT EXISTS vdoninja_guests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id INTEGER REFERENCES vdoninja_rooms(id) ON DELETE CASCADE,
                slot_number INTEGER NOT NULL,
                stream_id TEXT,
                guest_name TEXT,
                is_connected INTEGER DEFAULT 0,
                audio_enabled INTEGER DEFAULT 1,
                video_enabled INTEGER DEFAULT 1,
                volume REAL DEFAULT 1.0,
                joined_at DATETIME,
                UNIQUE(room_id, slot_number)
            )`,
            // VDO.Ninja Layouts
            `CREATE TABLE IF NOT EXISTS vdoninja_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                layout_type TEXT NOT NULL,
                layout_config TEXT NOT NULL,
                thumbnail_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        this.db.transaction(() => {
            schema.forEach(sql => this.db.exec(sql));
        })();
    }

    // --- Core API ---
    public run(sql: string, ...params: any[]): any {
        return this.db.prepare(sql).run(...params);
    }

    public get(sql: string, ...params: any[]): any {
        return this.db.prepare(sql).get(...params);
    }
    
    public prepare(sql: string): Database.Statement {
        return this.db.prepare(sql);
    }

    public all(sql: string, ...params: any[]): any[] {
        return this.db.prepare(sql).all(...params);
    }

    public transaction(fn: () => void): void {
        this.db.transaction(fn)();
    }



    // --- VDO.Ninja Methods ---
    public createVDONinjaRoom(name: string, roomId: string, password?: string, maxGuests: number = 6): number {
        const result = this.run(
            'INSERT INTO vdoninja_rooms (room_name, room_id, password, max_guests, last_used) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
            name, roomId, password || null, maxGuests
        );
        return result.lastInsertRowid;
    }

    public getVDONinjaRoom(roomId: string): any {
        return this.get('SELECT * FROM vdoninja_rooms WHERE room_id = ?', roomId);
    }

    public updateVDONinjaRoom(id: number, updates: Record<string, any>): void {
        const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updates);
        this.run(`UPDATE vdoninja_rooms SET ${fields}, last_used = CURRENT_TIMESTAMP WHERE id = ?`, ...values, id);
    }

    public addGuest(roomId: number, slot: number, streamId: string, name: string): number {
        const result = this.run(
            'INSERT INTO vdoninja_guests (room_id, slot_number, stream_id, guest_name, is_connected, joined_at) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)',
            roomId, slot, streamId, name
        );
        return result.lastInsertRowid;
    }

    public getGuestsByRoom(roomId: number): any[] {
        return this.all('SELECT * FROM vdoninja_guests WHERE room_id = ? ORDER BY slot_number', roomId);
    }

    public removeGuest(id: number): void {
        this.run('DELETE FROM vdoninja_guests WHERE id = ?', id);
    }

    // --- Settings & Stats ---
    public saveStreamStats(stats: any): void {
        this.run(`
            INSERT OR REPLACE INTO stream_stats (id, viewers, likes, total_coins, followers, shares, gifts, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, stats.viewers, stats.likes, stats.totalCoins, stats.followers, stats.shares, stats.gifts);
    }

    public loadStreamStats(): any {
        const row = this.get('SELECT * FROM stream_stats WHERE id = 1');
        if (!row) return null;
        return {
            viewers: row.viewers,
            likes: row.likes,
            totalCoins: row.total_coins,
            followers: row.followers,
            shares: row.shares,
            gifts: row.gifts
        };
    }

    public getSetting(key: string, defaultValue: any = null): any {
        try {
            const row = this.get('SELECT value FROM settings WHERE key = ?', key) as { value: string } | undefined;
            if (!row) return defaultValue;
            try {
                return JSON.parse(row.value);
            } catch {
                return row.value;
            }
        } catch (error) {
            this.logger.error(`Error getting setting ${key}:`, error);
            return defaultValue;
        }
    }

    public setSetting(key: string, value: any): void {
        try {
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            this.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, stringValue);
        } catch (error) {
            this.logger.error(`Error setting ${key}:`, error);
        }
    }

    public getAllSettings(): Record<string, any> {
        try {
            const rows = this.all('SELECT key, value FROM settings');
            const settings: Record<string, any> = {};
            for (const row of rows) {
                try {
                    settings[row.key] = JSON.parse(row.value);
                } catch {
                    settings[row.key] = row.value;
                }
            }
            return settings;
        } catch (error) {
            this.logger.error('Error getting all settings:', error);
            return {};
        }
    }

    public deleteSetting(key: string): void {
        this.run('DELETE FROM settings WHERE key = ?', key);
    }

    public logEvent(type: string, username: string | null, data: any): void {
        this.run(
            'INSERT INTO event_logs (event_type, username, data, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            type,
            username,
            typeof data === 'string' ? data : JSON.stringify(data)
        );
    }

    public close(): void {
        if (this.db) this.db.close();
    }
}
