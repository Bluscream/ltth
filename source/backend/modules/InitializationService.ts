/**
 * Initialization Service
 * Tracks server initialization progress to prevent race conditions
 */

interface SystemState {
    serverStarted: boolean;
    pluginsLoaded: boolean;
    pluginsInitialized: boolean;
    pluginInjections: boolean;
    socketReady: boolean;
    databaseReady: boolean;
    ready: boolean;
}

interface PluginState {
    initialized: boolean;
    error: any;
    timestamp: number;
}

export class InitializationService {
    private state: SystemState;
    private pluginStates: Map<string, PluginState>;
    private pluginCount: number = 0;
    private errors: any[];
    private startTime: number;

    constructor() {
        this.state = {
            serverStarted: false,
            pluginsLoaded: false,
            pluginsInitialized: false,
            pluginInjections: false,
            socketReady: false,
            databaseReady: false,
            ready: false
        };

        this.pluginStates = new Map();
        this.errors = [];
        this.startTime = Date.now();
    }

    public setDatabaseReady() {
        this.state.databaseReady = true;
        this.checkFullyReady();
    }

    public setPluginsLoaded(count: number) {
        this.state.pluginsLoaded = true;
        this.pluginCount = count;
        this.checkFullyReady();
    }

    public setPluginInitialized(pluginId: string, success: boolean, error: any = null) {
        this.pluginStates.set(pluginId, {
            initialized: success,
            error: error,
            timestamp: Date.now()
        });

        const allInitialized = Array.from(this.pluginStates.values())
            .every(state => state.initialized);

        if (allInitialized && this.pluginStates.size === this.pluginCount) {
            this.state.pluginsInitialized = true;
            this.checkFullyReady();
        }
    }

    public setAllPluginsInitialized() {
        this.state.pluginsInitialized = true;
        this.checkFullyReady();
    }

    public setPluginInjectionsComplete() {
        this.state.pluginInjections = true;
        this.checkFullyReady();
    }

    public setSocketReady() {
        this.state.socketReady = true;
        this.checkFullyReady();
    }

    public setServerStarted() {
        this.state.serverStarted = true;
        this.checkFullyReady();
    }

    private checkFullyReady() {
        const wasReady = this.state.ready;
        this.state.ready =
            this.state.databaseReady &&
            this.state.pluginsLoaded &&
            this.state.pluginsInitialized &&
            this.state.pluginInjections &&
            this.state.socketReady &&
            this.state.serverStarted;

        if (!wasReady && this.state.ready) {
            const elapsed = Date.now() - this.startTime;
            console.log(`✅ [InitializationService] System fully initialized in ${elapsed}ms`);
        }
    }

    public isReady(): boolean {
        return this.state.ready;
    }

    public getState(): SystemState {
        return { ...this.state };
    }

    public async waitForReady(timeout: number = 30000): Promise<boolean> {
        if (this.state.ready) return true;

        return new Promise((resolve, reject) => {
            const start = Date.now();
            const interval = setInterval(() => {
                if (this.state.ready) {
                    clearInterval(interval);
                    resolve(true);
                } else if (Date.now() - start > timeout) {
                    clearInterval(interval);
                    reject(new Error('Initialization timeout'));
                }
            }, 100);
        });
    }
}

// Export singleton
export const initState = new InitializationService();
