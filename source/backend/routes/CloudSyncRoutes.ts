import { Router } from 'express';
import { CloudSyncController } from '../controllers/CloudSyncController';
import { CloudSyncService } from '../modules/CloudSyncService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter } from '../modules/RateLimiter';

export class CloudSyncRoutes {
    private readonly router: Router;
    private readonly controller: CloudSyncController;

    constructor(
        private readonly cloudSync: CloudSyncService,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.controller = new CloudSyncController(this.cloudSync, this.logger);
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/status', apiLimiter as any, this.controller.getStatus);
        this.router.post('/enable', apiLimiter as any, this.controller.enableSync);
        this.router.post('/disable', apiLimiter as any, this.controller.disableSync);
        this.router.post('/sync', apiLimiter as any, this.controller.manualSync);
        this.router.get('/validate', apiLimiter as any, this.controller.validatePath);
    }

    public getRouter(): Router {
        return this.router;
    }
}
