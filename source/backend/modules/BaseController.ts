import { Request, Response, NextFunction } from 'express';
import { ILogger } from './LoggerService';

export abstract class BaseController {
    constructor(protected readonly logger: ILogger) {}

    protected sendSuccess(res: Response, data: any = {}, message: string = 'Success', status: number = 200): void {
        res.status(status).json({
            success: true,
            message,
            ...data
        });
    }

    protected sendError(res: Response, error: string = 'Internal Server Error', message: string = 'Error', status: number = 500): void {
        res.status(status).json({
            success: false,
            message,
            error
        });
    }

    protected catchAsync(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
        return (req: Request, res: Response, next: NextFunction) => {
            fn(req, res, next).catch(next);
        };
    }
}
