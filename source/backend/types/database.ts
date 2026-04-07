/**
 * Database Setting Record
 */
export interface DatabaseSetting {
    key: string;
    value: string;
    category?: string;
    updated_at: string;
}

/**
 * Persisted Stream Stats
 */
export interface PersistedStreamStats {
    viewers: number;
    likes: number;
    totalCoins: number;
    followers: number;
    shares: number;
    gifts: number;
    last_updated: string;
}

/**
 * Event Log Record
 */
export interface EventLogEntry {
    id?: number;
    type: string;
    username: string;
    data: string; // JSON string
    timestamp: string;
}

/**
 * Simplified database interface for core services
 */
export interface IDatabase {
    getSetting(key: string): string | null;
    setSetting(key: string, value: string): void;
    saveStreamStats(stats: any): void;
    loadStreamStats(): any;
    logEvent(type: string, username: string, data: any): void;
}

/**
 * Collection of DatabaseSettings
 */
export type DatabaseSettings = DatabaseSetting[];
