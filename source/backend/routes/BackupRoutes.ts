import { Router, Request, Response } from 'express';
import { BackupManager } from '../modules/BackupManager';
import { ILogger } from '../modules/LoggerService';
import multer from 'multer';
import os from 'os';
import path from 'path';

export class BackupRoutes {
    private readonly router: Router;
    private readonly upload: any;

    constructor(
        private readonly backupManager: BackupManager,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.upload = multer({ dest: path.join(os.tmpdir(), 'ltth-backups') });
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.get('/export', async (req: Request, res: Response) => {
            try {
                const { stream, warnings } = await this.backupManager.export(req.query);
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename=ltth_backup_${Date.now()}.zip`);
                if (warnings.length > 0) res.setHeader('X-LTTH-Warnings', JSON.stringify(warnings));
                stream.pipe(res);
            } catch (error: any) {
                this.logger.error(`Export failed: ${error.message}`);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.router.post('/import/parse', this.upload.single('backup'), async (req: Request, res: Response) => {
            if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
            try {
                const parsed = await this.backupManager.parseBackup(req.file.path, req.file.size);
                res.json({ success: true, parsed });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.router.post('/import/perform', async (req: Request, res: Response) => {
            const { parsed, options } = req.body;
            try {
                const result = await this.backupManager.import(parsed, options);
                res.json(result);
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.router.get('/capabilities', (req: Request, res: Response) => {
            res.json(this.backupManager.getCapabilities());
        });
    }

    public getRouter(): Router {
        return this.router;
    }
}
