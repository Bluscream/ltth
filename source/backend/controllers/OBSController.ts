import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { OBSService } from '../modules/OBSService';
import { ILogger } from '../modules/LoggerService';

export class OBSController extends BaseController {
    constructor(
        private readonly obsService: OBSService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/obs/status - Get OBS connection status
     */
    public getStatus = (req: Request, res: Response) => {
        try {
            const status = this.obsService.getStatus();
            this.sendSuccess(res, status);
        } catch (error: any) {
            this.logger.error('Failed to get OBS status:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/obs/connect - Connect to OBS
     */
    public connect = async (req: Request, res: Response) => {
        try {
            const { host, port, password } = req.body;
            const success = await this.obsService.connect(host, port, password);
            
            if (success) {
                this.sendSuccess(res, { success: true, message: 'Connected to OBS' });
            } else {
                this.sendError(res, 'Failed to connect to OBS', 'Error', 500);
            }
        } catch (error: any) {
            this.logger.error('Failed to connect to OBS:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/obs/disconnect - Disconnect from OBS
     */
    public disconnect = async (req: Request, res: Response) => {
        try {
            await this.obsService.disconnect();
            this.sendSuccess(res, { success: true, message: 'Disconnected from OBS' });
        } catch (error: any) {
            this.logger.error('Failed to disconnect from OBS:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/obs/scenes - Get all OBS scenes
     */
    public getScenes = async (req: Request, res: Response) => {
        try {
            if (!this.obsService.isConnected()) {
                return this.sendError(res, 'OBS not connected', 'Error', 400);
            }
            const scenes = await this.obsService.getScenes();
            this.sendSuccess(res, { scenes });
        } catch (error: any) {
            this.logger.error('Failed to get OBS scenes:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/obs/config - Save OBS configuration
     */
    public saveConfig = async (req: Request, res: Response) => {
        try {
            const config = req.body;
            await this.obsService.saveConfig(config);
            this.sendSuccess(res, { success: true, config });
        } catch (error: any) {
            this.logger.error('Failed to save OBS config:', error);
            this.sendError(res, error.message);
        }
    };
}
