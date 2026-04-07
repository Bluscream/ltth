import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { I18nService } from '../modules/I18nService';
import { ILogger } from '../modules/LoggerService';

export class I18nController extends BaseController {
    constructor(
        private readonly i18nService: I18nService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/i18n/translations - Get translations for a locale
     */
    public getTranslations = (req: Request, res: Response) => {
        try {
            const locale = req.params.locale || (req.query.locale as string) || 'en';
            const translations = this.i18nService.getAllTranslations(locale);
            
            this.sendSuccess(res, {
                locale,
                translations
            });
        } catch (error: any) {
            this.logger.error('Error getting translations:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/i18n/locales - Get available locales
     */
    public getLocales = (req: Request, res: Response) => {
        try {
            const locales = this.i18nService.getAvailableLocales();
            this.sendSuccess(res, { locales });
        } catch (error: any) {
            this.logger.error('Error getting locales:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/i18n/locale - Set current locale
     */
    public setLocale = (req: Request, res: Response) => {
        try {
            const { locale } = req.body;
            
            if (!locale) {
                return this.sendError(res, 'Locale is required', 'Error', 400);
            }
            
            const success = this.i18nService.setLocale(locale);
            
            if (success) {
                this.sendSuccess(res, { locale: this.i18nService.getLocale() });
            } else {
                this.sendError(res, 'Locale not found', 'Error', 404);
            }
        } catch (error: any) {
            this.logger.error('Error setting locale:', error);
            this.sendError(res, error.message);
        }
    };
}
