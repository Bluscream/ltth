import { Router } from 'express';
import { IFTTTController } from '../controllers/IFTTTController';
import { IFTTTService } from '../modules/ifttt/IFTTTService';
import { DatabaseService } from '../modules/DatabaseService';
import { ILogger } from '../modules/LoggerService';

export class IFTTTRoutes {
    private readonly router = Router();
    private readonly controller: IFTTTController;

    constructor(
        private readonly iftttService: IFTTTService,
        private readonly db: DatabaseService,
        private readonly logger: ILogger
    ) {
        this.controller = new IFTTTController(this.iftttService, this.db, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/', this.controller.getAllFlows);
        this.router.get('/:id', this.controller.getFlow);
        this.router.post('/', this.controller.createFlow);
        this.router.put('/:id', this.controller.updateFlow);
        this.router.delete('/:id', this.controller.deleteFlow);
        this.router.post('/:id/toggle', this.controller.toggleFlow);
        this.router.post('/:id/test', this.controller.testFlow);
    }

    public getRouter(): Router {
        return this.router;
    }
}
