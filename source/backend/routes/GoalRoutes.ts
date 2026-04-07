import { Router, Request, Response } from 'express';
import { GoalService } from '../modules/GoalService';
import { ILogger } from '../modules/LoggerService';

export class GoalRoutes {
    private readonly router: Router;

    constructor(
        private readonly goalService: GoalService,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/status', (req: Request, res: Response) => {
            const status = (this.goalService as any).getStatus();
            res.json(status);
        });

        this.router.post('/set/:key', async (req: Request, res: Response) => {
            const { key } = req.params;
            const { total } = req.body;
            await this.goalService.setGoal(key, parseInt(total) || 0);
            res.json({ success: true, message: `Goal ${key} updated` });
        });

        this.router.post('/reset/:key', async (req: Request, res: Response) => {
            await (this.goalService as any).resetGoal(req.params.key);
            res.json({ success: true, message: `Goal ${req.params.key} reset` });
        });

        this.router.post('/config/:key', async (req: Request, res: Response) => {
            const config = await (this.goalService as any).updateGoalConfig(req.params.key, req.body);
            res.json({ success: true, config });
        });

        this.router.post('/style/:key', async (req: Request, res: Response) => {
            const style = await (this.goalService as any).updateStyle(req.params.key, req.body);
            res.json({ success: true, style });
        });
    }

    public getRouter(): Router {
        return this.router;
    }
}
