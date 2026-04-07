import { ILogger } from '../LoggerService';
import { DatabaseService } from '../DatabaseService';
import { TikTokStats } from './types';

export class StatsManager {
    private stats: TikTokStats;

    constructor(
        private readonly db: DatabaseService,
        private readonly logger: ILogger
    ) {
        const savedStats = this.db.loadStreamStats();
        this.stats = savedStats || {
            viewers: 0,
            likes: 0,
            totalCoins: 0,
            followers: 0,
            shares: 0,
            gifts: 0
        };
    }

    public getStats(): TikTokStats {
        return { ...this.stats };
    }

    public updateStats(partial: Partial<TikTokStats>): void {
        this.stats = { ...this.stats, ...partial };
    }

    public addLikes(count: number): void {
        this.stats.likes += count;
    }

    public addGifts(count: number): void {
        this.stats.gifts += count;
    }

    public addCoins(count: number): void {
        this.stats.totalCoins += count;
    }

    public resetStats(): void {
        this.stats = {
            viewers: 0,
            likes: 0,
            totalCoins: 0,
            followers: 0,
            shares: 0,
            gifts: 0
        };
        this.db.saveStreamStats(this.stats);
        this.logger.info('📊 StatsManager: Stats reset');
    }

    public persist(): void {
        this.db.saveStreamStats(this.stats);
        this.logger.debug('💾 StatsManager: Stream stats persisted to database');
    }
}
