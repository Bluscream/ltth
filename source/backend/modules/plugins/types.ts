export interface PluginMetadata {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    entryPoint: string;
    dependencies?: Record<string, string>;
    permissions?: string[];
}

export interface PluginState {
    enabled: boolean;
    lastLoaded?: string;
    error?: string;
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

export interface FlowAction {
    actionName: string;
    handler: Function;
    pluginId: string;
}

export interface BackupProvider {
    exportConfig?: () => Promise<any>;
    importConfig?: (payload: any) => Promise<any>;
}
