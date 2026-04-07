import { ILogger } from './LoggerService';

export interface DebugEntry {
    id: number;
    timestamp: string;
    elapsed_ms: number;
    category: string;
    level: string;
    message: string;
    data: string | null;
}

export class DebugLogger {
    private entries: DebugEntry[] = [];
    private readonly maxEntries: number;
    public enabled: boolean = false;
    private filters: Record<string, boolean> = {
        'goals': true,
        'websocket': true,
        'ui': true,
        'tiktok': true,
        'csp': true,
        'errors': true,
        'socket-emit': true,
        'socket-receive': true
    };
    private startTime: number = Date.now();

    constructor(maxEntries: number = 1000) {
        this.maxEntries = maxEntries;
    }

    public log(category: string, message: string, data: any = null, level: string = 'info'): void {
        if (!this.enabled) return;
        if (this.filters[category] === false) return;

        const entry: DebugEntry = {
            id: this.entries.length,
            timestamp: new Date().toISOString(),
            elapsed_ms: Date.now() - this.startTime,
            category,
            level,
            message,
            data: data ? JSON.stringify(data).substring(0, 500) : null
        };

        this.entries.push(entry);
        
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }

        // Trace level console output
        const colors: Record<string, string> = {
            'info': '\x1b[36m',
            'warn': '\x1b[33m',
            'error': '\x1b[31m',
            'debug': '\x1b[35m'
        };
        const color = colors[level] || '\x1b[0m';
        // Note: We don't use the main logger here to avoid recursion if main logger uses debug logger
        console.log(`${color}[DEBUG:${category.toUpperCase()}] ${message}\x1b[0m`, data || '');
    }

    public getLogs(category: string | null = null, level: string | null = null, limit: number = 200): DebugEntry[] {
        let filtered = this.entries;

        if (category) {
            filtered = filtered.filter(e => e.category === category);
        }
        if (level) {
            filtered = filtered.filter(e => e.level === level);
        }

        return filtered.slice(-limit);
    }

    public getStats(): any {
        const byCategory: Record<string, number> = {};
        const byLevel: Record<string, number> = {};

        this.entries.forEach(e => {
            byCategory[e.category] = (byCategory[e.category] || 0) + 1;
            byLevel[e.level] = (byLevel[e.level] || 0) + 1;
        });

        return {
            total: this.entries.length,
            byCategory,
            byLevel,
            enabled: this.enabled,
            uptime_ms: Date.now() - this.startTime
        };
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = !!enabled;
    }

    public setFilter(category: string, enabled: boolean): void {
        this.filters[category] = !!enabled;
    }

    public clear(): void {
        this.entries = [];
        this.startTime = Date.now();
    }

    public export(): any {
        return {
            exported_at: new Date().toISOString(),
            entries: this.entries,
            stats: this.getStats()
        };
    }
}

// Export singleton
export const debugLogger = new DebugLogger();
