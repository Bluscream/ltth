import { Router } from 'express';
import { LeaderboardController } from '../controllers/LeaderboardController';
import { LeaderboardService } from '../modules/LeaderboardService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter, authLimiter } from '../modules/RateLimiter';

export class LeaderboardRoutes {
    private router = Router();
    private controller: LeaderboardController;

    constructor(
        private readonly leaderboardService: LeaderboardService,
        private readonly logger: ILogger
    ) {
        this.controller = new LeaderboardController(this.leaderboardService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/top/gifters', apiLimiter as any, this.controller.getGifters);
        this.router.get('/top/chatters', apiLimiter as any, this.controller.getChatters);
        this.router.get('/stats/:username', apiLimiter as any, this.controller.getUserStats);
        this.router.get('/summary', apiLimiter as any, this.controller.getSummary);
        this.router.post('/reset', authLimiter as any, this.controller.reset);
    }

    public getRouter(): Router {
        return this.router;
    }
}
