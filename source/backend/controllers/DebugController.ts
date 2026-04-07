import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { ILogger } from '../modules/LoggerService';
import { DebugLogger } from '../modules/DebugLogger';

export class DebugController extends BaseController {
    constructor(
        private readonly debugLogger: DebugLogger,
        logger: ILogger
    ) {
        super(logger);
    }

    public getStatus = (req: Request, res: Response) => {
        try {
            this.sendSuccess(res, {
                enabled: this.debugLogger.enabled,
                stats: this.debugLogger.getStats()
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public enableDebug = (req: Request, res: Response) => {
        try {
            const { enable } = req.body;
            this.debugLogger.setEnabled(enable);
            this.logger.info(`[DEBUG] Logging ${enable ? 'enabled' : 'disabled'}`);

            this.sendSuccess(res, {
                enabled: this.debugLogger.enabled,
                message: `Debug logging ${enable ? 'enabled' : 'disabled'}`
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public setFilter = (req: Request, res: Response) => {
        try {
            const { category, enabled } = req.body;
            this.debugLogger.setFilter(category, enabled);

            this.sendSuccess(res, {
                message: `Filter '${category}' set to ${enabled}`
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public getLogs = (req: Request, res: Response) => {
        try {
            const { category, level, limit } = req.query;
            const parsedLimit = limit ? parseInt(limit as string, 10) : 200;
            const logs = this.debugLogger.getLogs(
                category as string || null,
                level as string || null,
                parsedLimit
            );

            this.sendSuccess(res, {
                count: logs.length,
                logs,
                stats: this.debugLogger.getStats()
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public exportLogs = (req: Request, res: Response) => {
        try {
            const data = this.debugLogger.export();
            
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename=debug-logs-${Date.now()}.json`);
            this.sendSuccess(res, { data });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public clearLogs = (req: Request, res: Response) => {
        try {
            this.debugLogger.clear();
            this.logger.info('[DEBUG] Logs cleared');
            this.sendSuccess(res, { message: 'Debug logs cleared' });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };
}
