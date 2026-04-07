import { Router } from 'express';
import { AutoStartController } from '../controllers/AutoStartController';
import { AutoStartService } from '../modules/AutoStartService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter, authLimiter } from '../modules/RateLimiter';

export class AutoStartRoutes {
    private router = Router();
    private controller: AutoStartController;

    constructor(
        private readonly autoStartService: AutoStartService,
        private readonly logger: ILogger
    ) {
        this.controller = new AutoStartController(this.autoStartService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/status', apiLimiter as any, this.controller.getStatus);
        this.router.post('/toggle', authLimiter as any, this.controller.toggle);
        this.router.get('/platform', apiLimiter as any, this.controller.getPlatform);
    }

    public getRouter(): Router {
        return this.router;
    }
}
