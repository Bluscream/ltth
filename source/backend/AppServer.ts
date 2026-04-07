import { App } from './App';
import { PortService, PortResolution } from './modules/PortService';
import { LoggerService } from './modules/LoggerService';

export class AppServer {
    private app: App;
    private portService: PortService;
    private logger = LoggerService.getInstance();

    constructor() {
        this.app = new App();
        this.portService = new PortService(this.logger);
    }

    public async start(): Promise<void> {
        try {
            await this.app.initialize();
            const resolution: PortResolution = await this.portService.resolvePort();
            
            this.logger.info(`Starting server on port ${resolution.port} (action: ${resolution.action})`);
            await this.app.start(resolution.port);
            
            this.logger.info('🚀 LTTH Server is fully operational');
        } catch (error: any) {
            this.logger.error('❌ Failed to start AppServer:', error);
            process.exit(1);
        }
    }

    public getApp(): App {
        return this.app;
    }
}

// Start the server if this is the main module
if (require.main === module) {
    const server = new AppServer();
    server.start().catch(err => {
        console.error('Fatal server startup error:', err);
        process.exit(1);
    });
}
