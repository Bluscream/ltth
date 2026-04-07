import { Router } from 'express';
import { OBSController } from '../controllers/OBSController';
import { OBSService } from '../modules/OBSService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter, authLimiter } from '../modules/RateLimiter';

export class OBSRoutes {
    private router = Router();
    private controller: OBSController;

    constructor(
        private readonly obsService: OBSService,
        private readonly logger: ILogger
    ) {
        this.controller = new OBSController(this.obsService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/status', apiLimiter as any, this.controller.getStatus);
        this.router.get('/scenes', apiLimiter as any, this.controller.getScenes);
        this.router.post('/connect', authLimiter as any, this.controller.connect);
        this.router.post('/disconnect', authLimiter as any, this.controller.disconnect);
        this.router.post('/config', authLimiter as any, this.controller.saveConfig);
    }

    public getRouter(): Router {
        return this.router;
    }
}
