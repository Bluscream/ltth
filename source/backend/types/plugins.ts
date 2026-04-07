import { RequestHandler } from 'express';

export interface PluginMetadata {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    type?: string;
    entryPoint?: string;
    icon?: string;
    permissions?: string[];
}

export interface PluginState {
    enabled?: boolean;
    config?: Record<string, any>;
    lastLoaded?: string;
}

export interface RegisteredRoute {
    method: string;
    path: string;
    stale?: boolean;
    unregisteredAt?: Date;
}

export interface RegisteredSocketEvent {
    event: string;
    callback: Function;
}

export interface RegisteredTikTokEvent {
    event: string;
    callback: Function;
}

export interface PluginBackupProvider {
    exportConfig?: () => Promise<any>;
    importConfig?: (payload: any) => Promise<any>;
}

/**
 * Base Lifecycle for Application Plugins
 */
export interface Plugin {
    init?(): Promise<void>;
    start?(): Promise<void>;
    stop?(): Promise<void>;
    metadata: PluginMetadata;
}
