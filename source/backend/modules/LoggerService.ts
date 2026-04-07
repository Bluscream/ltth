import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

/**
 * Common Logger Interface
 */
export interface ILogger {
    info(message: string, context?: any): void;
    warn(message: string, context?: any): void;
    error(message: string, context?: any): void;
    debug(message: string, context?: any): void;
    tiktok?(message: string, meta?: any): void;
    obs?(message: string, meta?: any): void;
    api?(message: string, meta?: any): void;
}

/**
 * Logger Service - Winston-based logging system with TypeScript support
 */
export class LoggerService implements ILogger {
    private static instance: LoggerService;
    private logger: winston.Logger;
    private logsDir: string;

    private constructor() {
        this.logsDir = path.join(__dirname, '..', 'logs');
        this.ensureLogsDirectory();

        const fileFormat = winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }),
            winston.format.json()
        );

        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let msg = `${timestamp} [${level}]: ${message}`;
                if (Object.keys(meta).length > 0) {
                    msg += ` ${JSON.stringify(meta)}`;
                }
                return msg;
            })
        );

        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: fileFormat,
            transports: [
                new winston.transports.Console({
                    format: consoleFormat,
                    level: 'debug'
                }),
                new DailyRotateFile({
                    filename: path.join(this.logsDir, 'app-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: '20m',
                    maxFiles: '14d',
                    format: fileFormat,
                    level: 'info'
                }),
                new DailyRotateFile({
                    filename: path.join(this.logsDir, 'error-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: '20m',
                    maxFiles: '30d',
                    format: fileFormat,
                    level: 'error'
                })
            ],
            exceptionHandlers: [
                new winston.transports.File({ filename: path.join(this.logsDir, 'exceptions.log') })
            ],
            rejectionHandlers: [
                new winston.transports.File({ filename: path.join(this.logsDir, 'rejections.log') })
            ]
        });
    }

    public static getInstance(): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService();
        }
        return LoggerService.instance;
    }

    private ensureLogsDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }

    public info(message: string, context?: any) {
        this.logger.info(message, context);
    }

    public warn(message: string, context?: any) {
        this.logger.warn(message, context);
    }

    public error(message: string, context?: any) {
        this.logger.error(message, context);
    }

    public debug(message: string, context?: any) {
        this.logger.debug(message, context);
    }

    // Extended logging methods
    public tiktok(message: string, meta: any = {}) {
        this.info(`[TikTok] ${message}`, meta);
    }

    public obs(message: string, meta: any = {}) {
        this.info(`[OBS] ${message}`, meta);
    }

    public api(message: string, meta: any = {}) {
        this.info(`[API] ${message}`, meta);
    }
}

// Export a singleton instance for backward compatibility where needed
export const logger = LoggerService.getInstance();
