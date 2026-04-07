import { Request, Response, NextFunction } from 'express';
import { ILogger } from './LoggerService';

export class CORSManager {
    constructor(private readonly logger: ILogger) {}

    public handleCORS = (req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        
        next();
    };

    public handleCSP = (req: Request, res: Response, next: NextFunction) => {
        // Basic CSP for development, can be tightened for production
        res.setHeader('Content-Security-Policy', "default-src 'self' * 'unsafe-inline' 'unsafe-eval'; img-src 'self' * data: blob:; media-src 'self' * data: blob:; connect-src 'self' *;");
        next();
    };
}
