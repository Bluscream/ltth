import { Router, Request, Response } from 'express';
import { AlertService } from '../modules/AlertService';
import { ILogger } from '../modules/LoggerService';

export class AlertRoutes {
    private readonly router: Router;

    constructor(
        private readonly alertService: AlertService,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.post('/test', (req: Request, res: Response) => {
            const { type, data } = req.body;
            this.alertService.addAlert(type || 'gift', data || { username: 'Tester', giftName: 'Rose' });
            res.json({ success: true, message: 'Test alert queued' });
        });

        this.router.post('/skip', (req: Request, res: Response) => {
            this.alertService.skipCurrent();
            res.json({ success: true, message: 'Current alert skipped' });
        });

        this.router.post('/clear', (req: Request, res: Response) => {
            this.alertService.clearQueue();
            res.json({ success: true, message: 'Alert queue cleared' });
        });

        this.router.get('/config/:type', (req: Request, res: Response) => {
            const config = (this.alertService as any).getAlertConfig(req.params.type);
            res.json(config || { error: 'Config not found' });
        });
    }

    public getRouter(): Router {
        return this.router;
    }
}
