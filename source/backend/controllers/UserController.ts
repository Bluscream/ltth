import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { UserDatabaseService } from '../modules/UserDatabaseService';
import { ILogger } from '../modules/LoggerService';

/**
 * User Controller - Handles multi-user and multi-profile management
 */
export class UserController extends BaseController {
    constructor(
        private readonly userService: UserDatabaseService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/users
     * List all users
     */
    public getAllUsers = async (req: Request, res: Response): Promise<void> => {
        try {
            const users = this.userService.getAllUsers();
            this.sendSuccess(res, { users });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/users
     * Create a new user
     */
    public createUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const { username, language, avatar, displayName } = req.body;
            const user = this.userService.createUser(username, language, avatar, displayName);
            this.sendSuccess(res, { user });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/users/:username
     * Get user details and profiles
     */
    public getUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const { username } = req.params;
            const user = this.userService.getUser(username);
            if (user) {
                this.sendSuccess(res, { user });
            } else {
                this.sendError(res, 'User not found', 'Not Found', 404);
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * DELETE /api/users/:username
     * Delete user and all its data
     */
    public deleteUser = async (req: Request, res: Response): Promise<void> => {
        try {
            const { username } = req.params;
            const success = this.userService.deleteUser(username);
            if (success) {
                this.sendSuccess(res, { success: true });
            } else {
                this.sendError(res, 'User not found', 'Not Found', 404);
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };
}
