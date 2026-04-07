import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { ILogger } from '../modules/LoggerService';

/**
 * User Routes - Maps multi-user management API endpoints
 */
export class UserRoutes {
    private readonly router: Router;
    private readonly controller: UserController;

    constructor(controller: UserController, logger: ILogger) {
        this.router = Router();
        this.controller = controller;
        this.initializeRoutes();
    }

    private initializeRoutes(): void {
        this.router.get('/', this.controller.getAllUsers);
        this.router.post('/', this.controller.createUser);
        this.router.get('/:username', this.controller.getUser);
        this.router.delete('/:username', this.controller.deleteUser);
    }

    public getRouter(): Router {
        return this.router;
    }
}
