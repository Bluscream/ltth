import { Router } from 'express';
import { PluginController } from '../controllers/PluginController';
import { PluginLoader } from '../modules/PluginLoader';
import { ILogger } from '../modules/LoggerService';
import { Server as SocketServer } from 'socket.io';
import { apiLimiter, uploadLimiter } from '../modules/RateLimiter';
import multer from 'multer';
import os from 'os';
import path from 'path';

export class PluginRoutes {
    private readonly router: Router;
    private readonly controller: PluginController;
    private readonly upload: any;

    constructor(
        private readonly pluginLoader: PluginLoader,
        private readonly io: SocketServer | null,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.controller = new PluginController(this.pluginLoader, this.io, this.logger);
        
        const uploadDir = path.join(os.tmpdir(), 'ltth-plugin-uploads');
        this.upload = multer({
            dest: uploadDir,
            limits: { fileSize: 50 * 1024 * 1024 }
        });

        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/', apiLimiter as any, this.controller.getAllPlugins);
        this.router.get('/:id', apiLimiter as any, this.controller.getPluginDetails);
        this.router.post('/:id/enable', apiLimiter as any, this.controller.enablePlugin);
        this.router.post('/:id/disable', apiLimiter as any, this.controller.disablePlugin);
        this.router.post('/:id/reload', apiLimiter as any, this.controller.reloadPlugin);
        this.router.delete('/:id', apiLimiter as any, this.controller.deletePlugin);
        this.router.get('/:id/log', apiLimiter as any, this.controller.getPluginLog);

        // Upload route
        this.router.post('/upload', uploadLimiter as any, this.upload.single('plugin'), this.controller.uploadPlugin);
    }

    public getRouter(): Router {
        return this.router;
    }
}
