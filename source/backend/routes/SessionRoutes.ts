import { Router } from 'express';
import { SessionController } from '../controllers/SessionController';
import { ILogger } from '../modules/LoggerService';

/**
 * Session Routes - Maps TikTok session management API endpoints
 */
export class SessionRoutes {
    private readonly router: Router;
    private readonly controller: SessionController;

    constructor(controller: SessionController, logger: ILogger) {
        this.router = Router();
        this.controller = controller;
        this.initializeRoutes();
    }

    private initializeRoutes(): void {
        this.router.post('/extract', this.controller.extractSession);
        this.router.get('/status', this.controller.getStatus);
        
        // Manual session management
        this.router.post('/extract-manual', this.controller.extractManual);
        this.router.post('/import-manual', this.controller.importManual);
    }

    public getRouter(): Router {
        return this.router;
    }
}
