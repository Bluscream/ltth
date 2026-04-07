import { Router } from 'express';
import { I18nController } from '../controllers/I18nController';
import { I18nService } from '../modules/I18nService';
import { ILogger } from '../modules/LoggerService';

export class I18nRoutes {
    private router = Router();
    private controller: I18nController;

    constructor(
        private readonly i18nService: I18nService,
        private readonly logger: ILogger
    ) {
        this.controller = new I18nController(this.i18nService, this.logger);
        this.initRoutes();
    }

    private initRoutes(): void {
        this.router.get('/translations/:locale?', this.controller.getTranslations);
        this.router.get('/locales', this.controller.getLocales);
        this.router.post('/locale', this.controller.setLocale);
    }

    public getRouter(): Router {
        return this.router;
    }
}
