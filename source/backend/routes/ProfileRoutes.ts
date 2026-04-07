import { Router } from 'express';
import { ProfileController } from '../controllers/ProfileController';
import { ProfileService } from '../modules/ProfileService';
import { ILogger } from '../modules/LoggerService';
import { authLimiter, apiLimiter } from '../modules/RateLimiter';

export class ProfileRoutes {
    private router = Router();
    private controller: ProfileController;

    constructor(
        private readonly profileService: ProfileService,
        private readonly logger: ILogger
    ) {
        this.controller = new ProfileController(this.profileService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/', apiLimiter as any, this.controller.list);
        this.router.post('/', authLimiter as any, this.controller.create);
        this.router.get('/active', apiLimiter as any, this.controller.getActive);
        this.router.post('/active', authLimiter as any, this.controller.setActive);
        this.router.get('/aliases', apiLimiter as any, this.controller.getAliases);
        this.router.delete('/:username', authLimiter as any, this.controller.delete);
        this.router.post('/backup', authLimiter as any, this.controller.backup);
        this.router.get('/find', apiLimiter as any, this.controller.find);
    }

    public getRouter(): Router {
        return this.router;
    }
}
