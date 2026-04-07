import { Router } from 'express';
import { DebugController } from '../controllers/DebugController';
import { DebugLogger } from '../modules/DebugLogger';
import { ILogger } from '../modules/LoggerService';
import { apiLimiter } from '../modules/RateLimiter';

export class DebugRoutes {
    private readonly router: Router;
    private readonly controller: DebugController;

    constructor(
        private readonly debugLogger: DebugLogger,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.controller = new DebugController(this.debugLogger, this.logger);
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/status', apiLimiter as any, this.controller.getStatus);
        this.router.post('/enable', apiLimiter as any, this.controller.enableDebug);
        this.router.post('/filter', apiLimiter as any, this.controller.setFilter);
        this.router.get('/logs', apiLimiter as any, this.controller.getLogs);
        this.router.get('/export', apiLimiter as any, this.controller.exportLogs);
        this.router.post('/clear', apiLimiter as any, this.controller.clearLogs);
    }

    public getRouter(): Router {
        return this.router;
    }
}
