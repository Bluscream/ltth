import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { ProfileService, UserProfile } from '../modules/ProfileService';
import { ILogger } from '../modules/LoggerService';

export class ProfileController extends BaseController {
    constructor(
        private readonly profileService: ProfileService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/profiles - List all profiles
     */
    public list = (req: Request, res: Response) => {
        try {
            const profiles: UserProfile[] = this.profileService.listProfiles();
            const activeProfile = this.profileService.getActiveProfile();
            
            this.sendSuccess(res, {
                profiles,
                activeProfile
            });
        } catch (error: any) {
            this.logger.error('Failed to list profiles:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/profiles/active - Get the current active profile
     */
    public getActive = (req: Request, res: Response) => {
        try {
            const activeProfile = this.profileService.getActiveProfile();
            this.sendSuccess(res, { activeProfile });
        } catch (error: any) {
            this.logger.error('Failed to get active profile:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/profiles/aliases - Get all aliases
     */
    public getAliases = (req: Request, res: Response) => {
        try {
            // Depending on ProfileService implementation, we mock it or use getAliases if available
            const aliases = (this.profileService as any).aliases || [];
            this.sendSuccess(res, { aliases });
        } catch (error: any) {
            this.logger.error('Failed to get aliases:', error);
            this.sendError(res, error.message);
        }
    };


    /**
     * POST /api/profiles - Create a new profile
     */
    public create = (req: Request, res: Response) => {
        try {
            const { username } = req.body;
            
            if (!username) {
                return this.sendError(res, 'Username is required', 'Error', 400);
            }

            const profile = this.profileService.createProfile(username);
            this.sendSuccess(res, { profile });
        } catch (error: any) {
            this.logger.error('Failed to create profile:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/profiles/active - Set active profile
     */
    public setActive = (req: Request, res: Response) => {
        try {
            const { username } = req.body;

            if (!username) {
                return this.sendError(res, 'Username is required', 'Error', 400);
            }

            if (!this.profileService.profileExists(username)) {
                return this.sendError(res, `Profile "${username}" does not exist`, 'Error', 404);
            }

            this.profileService.setActiveProfile(username);
            this.sendSuccess(res, { username });
        } catch (error: any) {
            this.logger.error('Failed to set active profile:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * DELETE /api/profiles/:username - Delete a profile
     */
    public delete = (req: Request, res: Response) => {
        try {
            const { username } = req.params;

            if (!username) {
                return this.sendError(res, 'Username is required', 'Error', 400);
            }

            const result = this.profileService.deleteProfile(username);
            this.sendSuccess(res, { success: result });
        } catch (error: any) {
            this.logger.error('Failed to delete profile:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/profiles/backup - Backup a profile
     */
    public backup = (req: Request, res: Response) => {
        try {
            const { username } = req.body;

            if (!username) {
                return this.sendError(res, 'Username is required', 'Error', 400);
            }

            const backup = this.profileService.backupProfile(username);
            this.sendSuccess(res, { backup });
        } catch (error: any) {
            this.logger.error('Failed to backup profile:', error);
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/profiles/find - Find profile by username
     */
    public find = (req: Request, res: Response) => {
        try {
            const username = req.query.username as string;

            if (!username) {
                return this.sendError(res, 'Username query parameter is required', 'Error', 400);
            }

            const profileName = this.profileService.findProfileByUsername(username);
            this.sendSuccess(res, { profileName });
        } catch (error: any) {
            this.logger.error('Failed to find profile:', error);
            this.sendError(res, error.message);
        }
    };
}
