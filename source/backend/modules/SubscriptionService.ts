import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export interface SubscriptionTier {
    tier: number;
    name: string;
    min_months: number;
    alert_sound: string | null;
    alert_text: string;
    alert_duration: number;
    gift_multiplier: number;
}

export interface UserSubscription {
    username: string;
    tier: number;
    tierName: string;
    total_months: number;
    subscribed_at: number;
    giftMultiplier: number;
}

export interface SubscriptionResult {
    username: string;
    tier: number;
    tierName: string;
    totalMonths: number;
    alertText: string;
    alertSound: string | null;
    alertDuration: number;
    giftMultiplier: number;
}

export class SubscriptionService {
    private tiers: SubscriptionTier[] = [];

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer | null = null,
        private readonly logger: ILogger
    ) {
        this.initDatabase();
        this.tiers = this.loadTiers();
    }

    private initDatabase(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS subscription_tiers (
                tier INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                min_months INTEGER NOT NULL,
                alert_sound TEXT,
                alert_text TEXT,
                alert_duration INTEGER DEFAULT 5,
                gift_multiplier REAL DEFAULT 1.0
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS user_subscriptions (
                username TEXT PRIMARY KEY,
                tier INTEGER NOT NULL,
                subscribed_at INTEGER NOT NULL,
                total_months INTEGER DEFAULT 1,
                FOREIGN KEY (tier) REFERENCES subscription_tiers(tier)
            )
        `);

        const tierCount = (this.db.get('SELECT COUNT(*) as count FROM subscription_tiers') as any).count;
        if (tierCount === 0) {
            this.db.run(`
                INSERT INTO subscription_tiers (tier, name, min_months, alert_text, alert_duration, gift_multiplier)
                VALUES
                    (1, 'Bronze', 1, '🥉 {username} subscribed (Bronze)!', 5, 1.0),
                    (2, 'Silver', 3, '🥈 {username} subscribed (Silver)!', 6, 1.2),
                    (3, 'Gold', 6, '🥇 {username} subscribed (Gold)!', 8, 1.5)
            `);
            this.logger.info('Default subscription tiers created');
        }
    }

    public loadTiers(): SubscriptionTier[] {
        return this.db.all('SELECT * FROM subscription_tiers ORDER BY tier ASC') as SubscriptionTier[];
    }

    public getTier(tierNumber: number): SubscriptionTier | undefined {
        return this.tiers.find(t => t.tier === tierNumber);
    }

    public determineTier(months: number): number {
        let tier = 1;
        for (const t of this.tiers) {
            if (months >= t.min_months) {
                tier = t.tier;
            }
        }
        return tier;
    }

    public handleSubscribe(username: string, _eventData: any = {}): SubscriptionResult {
        const existingUser = this.db.get(
            'SELECT * FROM user_subscriptions WHERE username = ?',
            username
        ) as any;

        let tier: number;
        let totalMonths: number = 1;

        if (existingUser) {
            totalMonths = existingUser.total_months + 1;
            tier = this.determineTier(totalMonths);
            this.db.run(
                'UPDATE user_subscriptions SET tier = ?, total_months = ?, subscribed_at = ? WHERE username = ?',
                tier, totalMonths, Date.now(), username
            );
            this.logger.info('User re-subscribed', { username, tier, totalMonths });
        } else {
            tier = 1;
            this.db.run(
                'INSERT INTO user_subscriptions (username, tier, subscribed_at, total_months) VALUES (?, ?, ?, ?)',
                username, tier, Date.now(), totalMonths
            );
            this.logger.info('New subscriber', { username, tier });
        }

        const tierConfig = this.getTier(tier)!;
        const result: SubscriptionResult = {
            username,
            tier,
            tierName: tierConfig.name,
            totalMonths,
            alertText: this.interpolate(tierConfig.alert_text, { username, tier: tierConfig.name, months: totalMonths }),
            alertSound: tierConfig.alert_sound,
            alertDuration: tierConfig.alert_duration,
            giftMultiplier: tierConfig.gift_multiplier
        };

        if (this.io) {
            this.io.emit('subscription:tier', result);
        }

        return result;
    }

    public getUserSubscription(username: string): UserSubscription | null {
        const sub = this.db.get(
            'SELECT * FROM user_subscriptions WHERE username = ?',
            username
        ) as any;

        if (!sub) return null;

        const tierConfig = this.getTier(sub.tier)!;

        return {
            username: sub.username,
            tier: sub.tier,
            tierName: tierConfig.name,
            total_months: sub.total_months,
            subscribed_at: sub.subscribed_at,
            giftMultiplier: tierConfig.gift_multiplier
        };
    }

    public getAllSubscribers(): any[] {
        return this.db.all(`
            SELECT us.username, us.tier, st.name as tierName, us.total_months, us.subscribed_at
            FROM user_subscriptions us
            JOIN subscription_tiers st ON us.tier = st.tier
            ORDER BY us.tier DESC, us.total_months DESC
        `);
    }

    public updateTier(tier: number, config: Partial<SubscriptionTier>): void {
        this.db.run(`
            UPDATE subscription_tiers
            SET name = ?, min_months = ?, alert_sound = ?, alert_text = ?,
                alert_duration = ?, gift_multiplier = ?
            WHERE tier = ?
        `,
            config.name,
            config.min_months,
            config.alert_sound || null,
            config.alert_text,
            config.alert_duration || 5,
            config.gift_multiplier || 1.0,
            tier
        );

        this.tiers = this.loadTiers();
        this.logger.info('Tier updated', { tier, config });
    }

    private interpolate(text: string, params: Record<string, any>): string {
        return text.replace(/\{(\w+)\}/g, (match, key) => {
            return key in params ? params[key] : match;
        });
    }

    public getStats(): any {
        const stats: any = { total: 0, byTier: {} };

        for (const tier of this.tiers) {
            const count = (this.db.get(
                'SELECT COUNT(*) as count FROM user_subscriptions WHERE tier = ?',
                tier.tier
            ) as any).count;
            stats.byTier[tier.name] = count;
            stats.total += count;
        }

        return stats;
    }
}
