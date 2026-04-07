import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { SubscriptionService } from '../modules/SubscriptionService';
import { ILogger } from '../modules/LoggerService';

export class SubscriptionController extends BaseController {
    constructor(
        private readonly subscriptionService: SubscriptionService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/subscriptions/tiers - Get all subscription tiers
     */
    public getTiers = (req: Request, res: Response) => {
        try {
            const tiers = this.subscriptionService.loadTiers();
            this.sendSuccess(res, { tiers });
        } catch (error: any) {
            this.logger.error('Failed to get subscription tiers:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/subscriptions/subscribers - Get all subscribers
     */
    public getSubscribers = (req: Request, res: Response) => {
        try {
            const subscribers = this.subscriptionService.getAllSubscribers();
            this.sendSuccess(res, { subscribers });
        } catch (error: any) {
            this.logger.error('Failed to get subscribers:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/subscriptions/stats - Get subscription statistics
     */
    public getStats = (req: Request, res: Response) => {
        try {
            const stats = this.subscriptionService.getStats();
            this.sendSuccess(res, stats);
        } catch (error: any) {
            this.logger.error('Failed to get subscription stats:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * PATCH /api/subscriptions/tiers/:tier - Update tier configuration
     */
    public updateTier = (req: Request, res: Response) => {
        try {
            const tier = parseInt(req.params.tier);
            const config = req.body;

            if (isNaN(tier)) {
                return this.sendError(res, 'Invalid tier number', 'Error', 400);
            }

            this.subscriptionService.updateTier(tier, config);
            this.sendSuccess(res, { success: true, tier, config });
        } catch (error: any) {
            this.logger.error('Failed to update subscription tier:', error);
            this.sendError(res, error.message);
        }
    };
}
