import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { LeaderboardService } from '../modules/LeaderboardService';
import { ILogger } from '../modules/LoggerService';

export class LeaderboardController extends BaseController {
    constructor(
        private readonly leaderboardService: LeaderboardService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/leaderboard/top/gifters - Get top gifters
     */
    public getGifters = (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const period = (req.query.period as string) || 'all_time';
            const gifters = this.leaderboardService.getTopGifters(limit, period);
            this.sendSuccess(res, { gifters });
        } catch (error: any) {
            this.logger.error('Failed to get top gifters:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/leaderboard/top/chatters - Get top chatters
     */
    public getChatters = (req: Request, res: Response) => {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const period = (req.query.period as string) || 'all_time';
            const chatters = this.leaderboardService.getTopChatters(limit, period);
            this.sendSuccess(res, { chatters });
        } catch (error: any) {
            this.logger.error('Failed to get top chatters:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/leaderboard/stats/:username - Get stats for a specific user
     */
    public getUserStats = (req: Request, res: Response) => {
        try {
            const { username } = req.params;
            const stats = this.leaderboardService.getUserStats(username);
            const rank = this.leaderboardService.getUserRank(username);
            
            if (!stats) {
                return this.sendError(res, 'User stats not found', 'Error', 404);
            }

            this.sendSuccess(res, { stats, rank });
        } catch (error: any) {
            this.logger.error('Failed to get user stats:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/leaderboard/summary - Get leaderboard summary
     */
    public getSummary = (req: Request, res: Response) => {
        try {
            const summary = this.leaderboardService.getSummary();
            this.sendSuccess(res, summary);
        } catch (error: any) {
            this.logger.error('Failed to get leaderboard summary:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/leaderboard/reset - Reset leaderboard
     */
    public reset = (req: Request, res: Response) => {
        try {
            const { period } = req.body;

            if (period === 'session') {
                this.leaderboardService.resetSessionStats();
            } else if (period === 'all') {
                this.leaderboardService.resetAllStats();
            } else {
                return this.sendError(res, 'Invalid reset period (must be session or all)', 'Error', 400);
            }

            this.sendSuccess(res, { success: true, period });
        } catch (error: any) {
            this.logger.error('Failed to reset leaderboard:', error);
            this.sendError(res, error.message);
        }
    };
}
