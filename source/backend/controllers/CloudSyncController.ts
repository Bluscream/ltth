import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { CloudSyncService } from '../modules/CloudSyncService';
import { ILogger } from '../modules/LoggerService';

export class CloudSyncController extends BaseController {
    constructor(
        private readonly cloudSync: CloudSyncService,
        logger: ILogger
    ) {
        super(logger);
    }

    public getStatus = (req: Request, res: Response) => {
        try {
            this.sendSuccess(res, this.cloudSync.getStatus());
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public enableSync = async (req: Request, res: Response) => {
        try {
            const { cloudPath } = req.body;
            await this.cloudSync.enable(cloudPath);
            this.sendSuccess(res, { message: 'Cloud sync enabled' });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public disableSync = async (req: Request, res: Response) => {
        try {
            await this.cloudSync.disable();
            this.sendSuccess(res, { message: 'Cloud sync disabled' });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public manualSync = async (req: Request, res: Response) => {
        try {
            const status = await this.cloudSync.manualSync();
            this.sendSuccess(res, status);
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    public validatePath = (req: Request, res: Response) => {
        try {
            const { path } = req.query;
            const result = this.cloudSync.validateCloudPath(path as string);
            this.sendSuccess(res, result);
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };
}
