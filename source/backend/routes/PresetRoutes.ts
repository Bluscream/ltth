import { Router } from 'express';
import { PresetController } from '../controllers/PresetController';
import { PresetService } from '../modules/PresetService';
import { ILogger } from '../modules/LoggerService';
import { authLimiter } from '../modules/RateLimiter';

export class PresetRoutes {
    private router = Router();
    private controller: PresetController;

    constructor(
        private readonly presetService: PresetService,
        private readonly logger: ILogger
    ) {
        this.controller = new PresetController(this.presetService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.post('/export', authLimiter as any, this.controller.export);
        this.router.post('/import', authLimiter as any, this.controller.import);
    }

    public getRouter(): Router {
        return this.router;
    }
}
