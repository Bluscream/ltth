import rateLimit from 'express-rate-limit';
import { ILogger } from '../modules/LoggerService';

export class RateLimiter {
    constructor(private readonly logger: ILogger) {}

    public get apiLimiter() {
        return rateLimit({
            windowMs: 60 * 1000,
            max: 100,
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                this.logger.warn(`Rate limit exceeded: ${req.ip} -> ${req.path}`);
                res.status(429).json({ error: 'Too many requests, please try again later' });
            }
        });
    }

    public get authLimiter() {
        return rateLimit({
            windowMs: 60 * 1000,
            max: 10,
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                this.logger.warn(`Auth rate limit exceeded: ${req.ip} -> ${req.path}`);
                res.status(429).json({ error: 'Too many connection attempts, please try again later' });
            }
        });
    }

    public get uploadLimiter() {
        return rateLimit({
            windowMs: 60 * 1000,
            max: 20,
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                this.logger.warn(`Upload rate limit exceeded: ${req.ip} -> ${req.path}`);
                res.status(429).json({ error: 'Too many file uploads, please try again later' });
            }
        });
    }

    public get pluginLimiter() {
        return rateLimit({
            windowMs: 60 * 1000,
            max: 200,
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                const ip = req.ip || req.socket.remoteAddress;
                return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
            },
            handler: (req, res) => {
                this.logger.warn(`Plugin rate limit exceeded: ${req.ip} -> ${req.path}`);
                res.status(429).json({ error: 'Too many plugin operations, please slow down' });
            }
        });
    }

    public get iftttLimiter() {
        return rateLimit({
            windowMs: 60 * 1000,
            max: 300,
            standardHeaders: true,
            legacyHeaders: false,
            skip: (req) => {
                const ip = req.ip || req.socket.remoteAddress;
                return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
            },
            handler: (req, res) => {
                this.logger.warn(`IFTTT rate limit exceeded: ${req.ip} -> ${req.path}`);
                res.status(429).json({ error: 'Too many IFTTT requests, please slow down' });
            }
        });
    }
}
