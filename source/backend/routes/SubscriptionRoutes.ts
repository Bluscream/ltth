import { Router } from 'express';
import { SubscriptionController } from '../controllers/SubscriptionController';
import { SubscriptionService } from '../modules/SubscriptionService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter, authLimiter } from '../modules/RateLimiter';

export class SubscriptionRoutes {
    private router = Router();
    private controller: SubscriptionController;

    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly logger: ILogger
    ) {
        this.controller = new SubscriptionController(this.subscriptionService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/tiers', apiLimiter as any, this.controller.getTiers);
        this.router.get('/subscribers', apiLimiter as any, this.controller.getSubscribers);
        this.router.get('/stats', apiLimiter as any, this.controller.getStats);
        this.router.patch('/tiers/:tier', authLimiter as any, this.controller.updateTier);
    }

    public getRouter(): Router {
        return this.router;
    }
}
