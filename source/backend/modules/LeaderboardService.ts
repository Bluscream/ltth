import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export interface LeaderboardStats {
    username: string;
    streamer_id: string;
    total_coins: number;
    message_count: number;
    like_count: number;
    share_count: number;
    gift_count: number;
    follow_count: number;
    first_seen: number;
    last_seen: number;
    session_coins: number;
    session_messages: number;
}

export interface LeaderboardSummary {
    total_users: number;
    total_coins: number;
    total_messages: number;
    total_gifts: number;
    session_start: number;
    session_duration: number;
}

export class LeaderboardService {
    private sessionStart: number;
    private readonly DEFAULT_STREAMER_ID = 'default';

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer | null = null,
        private streamerId: string = 'default',
        private readonly logger: ILogger
    ) {
        this.sessionStart = Date.now();
        this.initDatabase();
    }

    public setStreamerId(streamerId: string): void {
        this.streamerId = streamerId;
    }

    private initDatabase(): void {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS leaderboard_stats (
                username TEXT NOT NULL,
                streamer_id TEXT NOT NULL,
                total_coins INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                like_count INTEGER DEFAULT 0,
                share_count INTEGER DEFAULT 0,
                gift_count INTEGER DEFAULT 0,
                follow_count INTEGER DEFAULT 0,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                session_coins INTEGER DEFAULT 0,
                session_messages INTEGER DEFAULT 0,
                PRIMARY KEY (username, streamer_id)
            )
        `);

        this.migrateToStreamerIdColumn();
        this.logger.info('Leaderboard tables initialized');
    }

    private migrateToStreamerIdColumn(): void {
        try {
            const tableInfo = this.db.all('PRAGMA table_info(leaderboard_stats)');
            const hasStreamerId = tableInfo.some((col: any) => col.name === 'streamer_id');

            if (!hasStreamerId) {
                this.logger.info('Migrating leaderboard_stats table to add streamer_id column');
                const rowCount = (this.db.get('SELECT COUNT(*) as count FROM leaderboard_stats') as any).count;

                if (rowCount > 0) {
                    this.db.run(`
                        CREATE TABLE leaderboard_stats_new (
                            username TEXT NOT NULL,
                            streamer_id TEXT NOT NULL,
                            total_coins INTEGER DEFAULT 0,
                            message_count INTEGER DEFAULT 0,
                            like_count INTEGER DEFAULT 0,
                            share_count INTEGER DEFAULT 0,
                            gift_count INTEGER DEFAULT 0,
                            follow_count INTEGER DEFAULT 0,
                            first_seen INTEGER NOT NULL,
                            last_seen INTEGER NOT NULL,
                            session_coins INTEGER DEFAULT 0,
                            session_messages INTEGER DEFAULT 0,
                            PRIMARY KEY (username, streamer_id)
                        )
                    `);

                    this.db.run(`
                        INSERT INTO leaderboard_stats_new
                        SELECT username, ?, total_coins, message_count, like_count, share_count,
                               gift_count, follow_count, first_seen, last_seen,
                               session_coins, session_messages
                        FROM leaderboard_stats
                    `, this.DEFAULT_STREAMER_ID);

                    this.db.run('DROP TABLE leaderboard_stats');
                    this.db.run('ALTER TABLE leaderboard_stats_new RENAME TO leaderboard_stats');
                    this.logger.info('Successfully migrated leaderboard_stats table');
                } else {
                    this.db.run('DROP TABLE leaderboard_stats');
                    this.initDatabase();
                    this.logger.info('Recreated empty leaderboard_stats table');
                }
            }
        } catch (error: any) {
            this.logger.error('Error during leaderboard migration:', error);
            throw error;
        }
    }

    public updateStats(username: string, eventType: string, data: any = {}): void {
        const now = Date.now();
        const sid = this.streamerId;

        let stats = this.db.get(
            'SELECT * FROM leaderboard_stats WHERE username = ? AND streamer_id = ?',
            username, sid
        ) as LeaderboardStats | undefined;

        if (!stats) {
            stats = {
                username,
                streamer_id: sid,
                total_coins: 0,
                message_count: 0,
                like_count: 0,
                share_count: 0,
                gift_count: 0,
                follow_count: 0,
                first_seen: now,
                last_seen: now,
                session_coins: 0,
                session_messages: 0
            };
        }

        switch (eventType) {
            case 'gift':
                stats.total_coins += data.coins || 0;
                stats.gift_count += 1;
                stats.session_coins += data.coins || 0;
                break;
            case 'chat':
                stats.message_count += 1;
                stats.session_messages += 1;
                break;
            case 'like':
                stats.like_count += data.count || 1;
                break;
            case 'share':
                stats.share_count += 1;
                break;
            case 'follow':
                stats.follow_count += 1;
                break;
        }

        stats.last_seen = now;

        this.db.run(`
            INSERT INTO leaderboard_stats (
                username, streamer_id, total_coins, message_count, like_count, share_count,
                gift_count, follow_count, first_seen, last_seen,
                session_coins, session_messages
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username, streamer_id) DO UPDATE SET
                total_coins = excluded.total_coins,
                message_count = excluded.message_count,
                like_count = excluded.like_count,
                share_count = excluded.share_count,
                gift_count = excluded.gift_count,
                follow_count = excluded.follow_count,
                last_seen = excluded.last_seen,
                session_coins = excluded.session_coins,
                session_messages = excluded.session_messages
        `, ...Object.values(stats));

        this.logger.debug('Leaderboard stats updated', { username, eventType, streamerId: sid });

        if (this.io) {
            this.io.to('leaderboard').emit('leaderboard:update', {
                username,
                eventType,
                stats: this.getUserStats(username)
            });
        }
    }

    public getTopGifters(limit: number = 10, period: string = 'all_time'): any[] {
        const sid = this.streamerId;
        const column = period === 'session' ? 'session_coins' : 'total_coins';

        return this.db.all(`
            SELECT username, ${column} as coins, gift_count, last_seen
            FROM leaderboard_stats
            WHERE streamer_id = ? AND ${column} > 0
            ORDER BY ${column} DESC
            LIMIT ?
        `, sid, limit);
    }

    public getTopChatters(limit: number = 10, period: string = 'all_time'): any[] {
        const sid = this.streamerId;
        const column = period === 'session' ? 'session_messages' : 'message_count';

        return this.db.all(`
            SELECT username, ${column} as message_count, last_seen
            FROM leaderboard_stats
            WHERE streamer_id = ? AND ${column} > 0
            ORDER BY ${column} DESC
            LIMIT ?
        `, sid, limit);
    }

    public getUserRank(username: string, period: string = 'all_time'): number | null {
        const sid = this.streamerId;
        const column = period === 'session' ? 'session_coins' : 'total_coins';

        const row = this.db.get(`
            SELECT COUNT(*) + 1 as rank
            FROM leaderboard_stats
            WHERE streamer_id = ? AND ${column} > (
                SELECT ${column}
                FROM leaderboard_stats
                WHERE username = ? AND streamer_id = ?
            )
        `, sid, username, sid) as any;

        return row ? row.rank : null;
    }

    public getUserStats(username: string): LeaderboardStats | undefined {
        return this.db.get(
            'SELECT * FROM leaderboard_stats WHERE username = ? AND streamer_id = ?',
            username, this.streamerId
        ) as LeaderboardStats | undefined;
    }

    public resetSessionStats(): void {
        this.db.run('UPDATE leaderboard_stats SET session_coins = 0, session_messages = 0 WHERE streamer_id = ?', this.streamerId);
        this.sessionStart = Date.now();
        this.logger.info(`Session leaderboard stats reset for streamer: ${this.streamerId}`);
    }

    public resetAllStats(): void {
        this.db.run('DELETE FROM leaderboard_stats WHERE streamer_id = ?', this.streamerId);
        this.sessionStart = Date.now();
        this.logger.info(`All leaderboard stats reset for streamer: ${this.streamerId}`);
    }

    public getSummary(): LeaderboardSummary {
        const stats = this.db.get(`
            SELECT COUNT(*) as total_users, SUM(total_coins) as total_coins,
                   SUM(message_count) as total_messages, SUM(gift_count) as total_gifts
            FROM leaderboard_stats
            WHERE streamer_id = ?
        `, this.streamerId) as any;

        return {
            ...stats,
            session_start: this.sessionStart,
            session_duration: Date.now() - this.sessionStart
        };
    }

    public exportData(): LeaderboardStats[] {
        return this.db.all('SELECT * FROM leaderboard_stats WHERE streamer_id = ? ORDER BY total_coins DESC', this.streamerId) as LeaderboardStats[];
    }
}
