import { Router } from 'express';
import { WikiController } from '../controllers/WikiController';
import { ILogger } from '../modules/LoggerService';

export class WikiRoutes {
    private readonly router: Router;
    private readonly controller: WikiController;

    constructor(private readonly logger: ILogger) {
        this.router = Router();
        this.controller = new WikiController(this.logger);
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/structure', this.controller.getStructure);
        this.router.get('/page/:pageId', this.controller.getPage);
        this.router.get('/search', this.controller.search);
    }

    public getRouter(): Router {
        return this.router;
    }
}
