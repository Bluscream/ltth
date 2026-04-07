import { Request, Response, NextFunction } from 'express';
import { ILogger, LoggerService } from './LoggerService';

export class RateLimiter {
    private requests: Map<string, number[]> = new Map();

    constructor(private readonly logger: ILogger) {}

    public apiLimiter = (req: Request, res: Response, next: NextFunction) => {
        const key = `${req.ip}:${req.path}`;
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        const recent = timestamps.filter(t => t > now - 60000);
        
        if (recent.length > 100) {
            this.logger.warn(`Rate limit exceeded for ${req.ip} on ${req.path}`);
            return res.status(429).json({ success: false, error: 'Too many requests' });
        }
        
        recent.push(now);
        this.requests.set(key, recent);
        next();
    };

    public authLimiter = (req: Request, res: Response, next: NextFunction) => {
        const key = `auth:${req.ip}`;
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        const recent = timestamps.filter(t => t > now - 3600000); // 1 hour window
        
        if (recent.length > 5) {
            this.logger.warn(`Potential auth brute force detected from ${req.ip}`);
            return res.status(429).json({ success: false, error: 'Too many authentication attempts' });
        }
        
        recent.push(now);
        this.requests.set(key, recent);
        next();
    };

    public uploadLimiter = (req: Request, res: Response, next: NextFunction) => {
        const key = `upload:${req.ip}`;
        const now = Date.now();
        const timestamps = this.requests.get(key) || [];
        const recent = timestamps.filter(t => t > now - 3600000);
        if (recent.length > 10) return res.status(429).json({ success: false, error: 'Too many uploads' });
        recent.push(now);
        this.requests.set(key, recent);
        next();
    };
}

// Export a singleton for easy import
const globalLimiter = new RateLimiter(LoggerService.getInstance());
export const apiLimiter = globalLimiter.apiLimiter;
export const authLimiter = globalLimiter.authLimiter;
export const uploadLimiter = globalLimiter.uploadLimiter;
