import { ILogger } from '../LoggerService';

/**
 * VariableStore - Manages variables, context, and state for automation flows
 */
export class VariableStore {
    private logger: ILogger;
    private variables: Map<string, any> = new Map();
    private counters: Map<string, number> = new Map();
    private cooldowns: Map<string, number> = new Map();
    private rateLimits: Map<string, number[]> = new Map();
    private state: any = {
        tiktok: {
            connected: false,
            viewerCount: 0,
            likeCount: 0
        },
        tts: {
            isSpeaking: false,
            queueLength: 0
        },
        system: {
            uptime: 0,
            lastEvent: null
        }
    };
    private eventHistory: any[] = [];
    private maxEventHistory = 100;

    constructor(logger: ILogger = console) {
        this.logger = logger;
    }

    public set(key: string, value: any): void {
        this.variables.set(key, value);
    }

    public get(key: string, defaultValue: any = null): any {
        return this.variables.has(key) ? this.variables.get(key) : defaultValue;
    }

    public delete(key: string): boolean {
        return this.variables.delete(key);
    }

    public has(key: string): boolean {
        return this.variables.has(key);
    }

    public getAllVariables(): Record<string, any> {
        return Object.fromEntries(this.variables);
    }

    public clearVariables(): void {
        this.variables.clear();
    }

    public increment(key: string, amount: number = 1): number {
        const current = this.counters.get(key) || 0;
        const newValue = current + amount;
        this.counters.set(key, newValue);
        return newValue;
    }

    public decrement(key: string, amount: number = 1): number {
        return this.increment(key, -amount);
    }

    public getCounter(key: string): number {
        return this.counters.get(key) || 0;
    }

    public resetCounter(key: string): void {
        this.counters.set(key, 0);
    }

    public setCooldown(key: string, timestamp: number = Date.now()): void {
        this.cooldowns.set(key, timestamp);
    }

    public isCooldownActive(key: string, seconds: number): boolean {
        const lastTrigger = this.cooldowns.get(key);
        if (!lastTrigger) return false;
        const elapsed = (Date.now() - lastTrigger) / 1000;
        return elapsed < seconds;
    }

    public getCooldownRemaining(key: string, seconds: number): number {
        const lastTrigger = this.cooldowns.get(key);
        if (!lastTrigger) return 0;
        const elapsed = (Date.now() - lastTrigger) / 1000;
        const remaining = seconds - elapsed;
        return remaining > 0 ? remaining : 0;
    }

    public clearCooldown(key: string): void {
        this.cooldowns.delete(key);
    }

    public addRateLimitEntry(key: string): void {
        const queue = this.rateLimits.get(key) || [];
        queue.push(Date.now());
        this.rateLimits.set(key, queue);
    }

    public checkRateLimit(key: string, maxCount: number, windowSeconds: number): boolean {
        const queue = this.rateLimits.get(key) || [];
        const now = Date.now();
        const cutoff = now - (windowSeconds * 1000);
        const recent = queue.filter(t => t > cutoff);
        this.rateLimits.set(key, recent);
        return recent.length < maxCount;
    }

    public updateState(path: string, value: any): void {
        const parts = path.split('.');
        if (parts.some(part => ['__proto__', 'constructor', 'prototype'].includes(part))) {
            return;
        }
        let current = this.state;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        const lastKey = parts[parts.length - 1];
        current[lastKey] = value;
    }

    public getState(path: string): any {
        const parts = path.split('.');
        let current = this.state;
        for (const part of parts) {
            if (current === null || current === undefined) return null;
            current = current[part];
        }
        return current;
    }

    public addEvent(event: any): void {
        this.eventHistory.push({ ...event, timestamp: Date.now() });
        if (this.eventHistory.length > this.maxEventHistory) {
            this.eventHistory.shift();
        }
        this.updateState('system.lastEvent', event);
    }

    public createContext(eventData: any, meta: any = {}): any {
        return {
            data: eventData, // Event-specific data
            vars: Object.fromEntries(this.variables), // Current variables
            state: this.state, // Current system state
            meta, // Flow metadata (ID, Name, etc.)
            timestamp: Date.now()
        };
    }

    public getNestedValue(obj: any, path: string): any {
        if (!path) return obj;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined) return undefined;
            if (['__proto__', 'constructor', 'prototype'].includes(part)) return undefined;
            current = current[part];
        }
        return current;
    }

    public exportState(): any {
        return {
            variables: Object.fromEntries(this.variables),
            counters: Object.fromEntries(this.counters),
            state: this.state,
            eventHistory: this.eventHistory.slice(-10)
        };
    }

    public importState(data: any): void {
        if (data.variables) this.variables = new Map(Object.entries(data.variables));
        if (data.counters) this.counters = new Map(Object.entries(data.counters));
        if (data.state) this.state = data.state;
        if (data.eventHistory) this.eventHistory = data.eventHistory;
    }
}
