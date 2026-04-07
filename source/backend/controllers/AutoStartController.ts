import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { AutoStartService, AutoStartStatus } from '../modules/AutoStartService';
import { ILogger } from '../modules/LoggerService';

export class AutoStartController extends BaseController {
    constructor(
        private readonly autoStartService: AutoStartService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/autostart/status - Get auto-start status
     */
    public getStatus = async (req: Request, res: Response) => {
        try {
            const status: AutoStartStatus = await this.autoStartService.getStatus();
            this.sendSuccess(res, status);
        } catch (error: any) {
            this.logger.error(`Auto-start status check failed: ${error.message}`);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/autostart/toggle - Enable/Disable auto-start
     */
    public toggle = async (req: Request, res: Response) => {
        try {
            const { enabled, hidden } = req.body;

            if (typeof enabled !== 'boolean') {
                return this.sendError(res, 'enabled must be a boolean', 'Error', 400);
            }

            const result = await this.autoStartService.toggle(enabled, hidden || false);

            if (result) {
                this.logger.info(`Auto-start ${enabled ? 'enabled' : 'disabled'} (hidden: ${hidden})`);
                this.sendSuccess(res, { enabled, hidden: hidden || false });
            } else {
                this.sendError(res, 'Failed to toggle auto-start');
            }
        } catch (error: any) {
            this.logger.error(`Auto-start toggle failed: ${error.message}`);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/autostart/platform - Get platform information
     */
    public getPlatform = (req: Request, res: Response) => {
        try {
            const platformInfo = this.autoStartService.getPlatformInfo();
            this.sendSuccess(res, {
                ...platformInfo,
                supported: this.autoStartService.isSupported()
            });
        } catch (error: any) {
            this.logger.error(`Platform info failed: ${error.message}`);
            this.sendError(res, error.message);
        }
    };
}
