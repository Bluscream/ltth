import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { SessionExtractorService } from '../modules/SessionExtractorService';
import { ILogger } from '../modules/LoggerService';

/**
 * Session Controller - Handles TikTok session extraction and management
 */
export class SessionController extends BaseController {
    constructor(
        private readonly sessionService: SessionExtractorService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * POST /api/session/extract
     * Extract session ID using Eulerstream or Puppeteer
     */
    public extractSession = async (req: Request, res: Response): Promise<void> => {
        try {
            const { apiKey, accountId, usePuppeteer } = req.body;
            
            this.logger.info(`[SessionController] Starting session extraction (Puppeteer: ${!!usePuppeteer})`);
            
            const result = await this.sessionService.extractSessionId({
                apiKey,
                accountId,
                forcePuppeteer: !!usePuppeteer
            });

            if (result.success) {
                this.sendSuccess(res, result);
            } else {
                this.sendError(res, result.error || 'Failed to extract session');
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/session/extract-manual
     * Trigger manual session extraction (Launch browser)
     */
    public extractManual = async (req: Request, res: Response): Promise<void> => {
        try {
            this.logger.info(`[SessionController] Starting manual session extraction`);
            const result = await this.sessionService.extractSessionId({
                forcePuppeteer: true,
                headless: false
            });

            if (result.success) {
                this.sendSuccess(res, result);
            } else {
                this.sendError(res, result.error || 'Failed to extract session');
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/session/import-manual
     * Manually import session ID and target IDC
     */
    public importManual = async (req: Request, res: Response): Promise<void> => {
        try {
            const { sessionId, ttTargetIdc } = req.body;
            
            if (!sessionId) {
                return this.sendError(res, 'Session ID is required');
            }

            this.logger.info(`[SessionController] Manually importing session ID`);
            (this.sessionService as any).db.setSetting('tiktok_session_id', sessionId);
            if (ttTargetIdc) {
                (this.sessionService as any).db.setSetting('tiktok_tt_target_idc', ttTargetIdc);
            }
            
            this.sendSuccess(res, { success: true, message: 'Session imported successfully' });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/session/status
     * Get current session status
     */
    public getStatus = async (req: Request, res: Response): Promise<void> => {
        try {
            // Simplified status check
            const sessionId = (this.sessionService as any).db.getSetting('tiktok_session_id');
            this.sendSuccess(res, {
                hasSession: !!sessionId,
                lastExtracted: (this.sessionService as any).db.getSetting('tiktok_session_last_extracted')
            });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };
}
