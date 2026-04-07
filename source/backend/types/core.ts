/**
 * Application Configuration
 */
export interface AppConfig {
    port: number;
    env: 'production' | 'development' | 'test';
    version: string;
    isDev: boolean;
}

/**
 * Common Logger Interface
 */
export interface ILogger {
    info(message: string, context?: any): void;
    warn(message: string, context?: any): void;
    error(message: string, context?: any): void;
    debug(message: string, context?: any): void;
}

/**
 * Base Lifecycle for Application Modules
 */
export interface IAppModule {
    init?(): Promise<void>;
    start?(): Promise<void>;
    stop?(): Promise<void>;
    getStatus?(): string;
}

/**
 * Backwards compatibility for Module
 */
export interface Module extends IAppModule {}
