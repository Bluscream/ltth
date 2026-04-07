import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { UpdateService } from '../modules/UpdateService';
import { ILogger } from '../modules/LoggerService';
import path from 'path';

export class UpdateController extends BaseController {
    constructor(
        private readonly updateService: UpdateService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/update/check - Check for new versions
     */
    public check = async (req: Request, res: Response) => {
        try {
            const updateInfo = await this.updateService.checkForUpdates();
            res.json(updateInfo);
        } catch (error: any) {
            this.logger.error(`Update check failed: ${error.message}`);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/update/current - Get current version
     */
    public current = (req: Request, res: Response) => {
        res.json({
            success: true,
            version: this.updateService.currentVersion
        });
    };

    /**
     * POST /api/update/download - Perform update
     */
    public download = async (req: Request, res: Response) => {
        try {
            const result = await this.updateService.performUpdate();
            res.json(result);
        } catch (error: any) {
            this.logger.error(`Update download failed: ${error.message}`);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/update/instructions - Get manual update instructions
     */
    public instructions = (req: Request, res: Response) => {
        const githubRepo = 'Loggableim/pupcidslittletiktokhelper';
        const instructions = {
            method: this.updateService.isGitRepo ? 'git' : 'download',
            steps: this.updateService.isGitRepo
                ? [
                    '1. Stop the server (Ctrl+C)',
                    '2. Run "git pull" in the project directory',
                    '3. If package.json changed: "npm install"',
                    '4. Restart the server'
                  ]
                : [
                    '1. Download the latest version from GitHub',
                    `2. https://github.com/${githubRepo}/releases/latest`,
                    '3. Extract the archive',
                    '4. Copy your "user_data" and "user_configs" folders',
                    '5. Run "npm install"',
                    '6. Restart the server'
                  ]
        };

        this.sendSuccess(res, { instructions });
    };

    /**
     * GET /CHANGELOG.md - Serve changelog
     */
    public changelog = (req: Request, res: Response) => {
        const changelogPath = path.resolve(__dirname, '..', '..', 'CHANGELOG.md');
        res.sendFile(changelogPath, (err) => {
            if (err) {
                this.logger.error(`Failed to serve CHANGELOG.md: ${err.message}`);
                res.status(404).send('Changelog not found');
            }
        });
    };
}
