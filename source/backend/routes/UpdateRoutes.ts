import { Router } from 'express';
import { UpdateController } from '../controllers/UpdateController';
import { UpdateService } from '../modules/UpdateService';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter, authLimiter } from '../modules/RateLimiter'; // Use existing for now or refactor to use RateLimiter.ts classes

export class UpdateRoutes {
    private router = Router();
    private controller: UpdateController;

    constructor(
        private readonly updateService: UpdateService,
        private readonly logger: ILogger
    ) {
        this.controller = new UpdateController(this.updateService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/check', apiLimiter as any, this.controller.check);
        this.router.get('/current', apiLimiter as any, this.controller.current);
        this.router.post('/download', authLimiter as any, this.controller.download);
        this.router.get('/instructions', apiLimiter as any, this.controller.instructions);
        this.router.get('/changelog', apiLimiter as any, this.controller.changelog);
    }

    public getRouter(): Router {
        return this.router;
    }
}
