import { Request, Response, NextFunction } from 'express';
import { ILogger } from './LoggerService';

export class ErrorHandler {
    constructor(private readonly logger: ILogger) {}

    public handleErrors = (err: any, req: Request, res: Response, next: NextFunction) => {
        const statusCode = err.statusCode || 500;
        const message = err.message || 'Internal Server Error';

        if (statusCode >= 500) {
            this.logger.error(`${req.method} ${req.path} failed: ${message}`, { stack: err.stack });
        } else {
            this.logger.warn(`${req.method} ${req.path} client error: ${message}`);
        }

        res.status(statusCode).json({
            success: false,
            error: message,
            errorCode: err.code || 'UNKNOWN_ERROR'
        });
    };
}

export function asyncHandler(fn: Function) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
