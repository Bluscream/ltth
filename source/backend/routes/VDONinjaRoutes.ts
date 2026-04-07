import { Router } from 'express';
import { VDONinjaController } from '../controllers/VDONinjaController';
import { ILogger } from '../modules/LoggerService';

/**
 * VDO.Ninja Routes - Maps VDO.Ninja API endpoints to the controller
 */
export class VDONinjaRoutes {
    private readonly router: Router;
    private readonly controller: VDONinjaController;

    constructor(controller: VDONinjaController, logger: ILogger) {
        this.router = Router();
        this.controller = controller;
        this.initializeRoutes();
    }

    private initializeRoutes(): void {
        // Rooms
        this.router.get('/rooms', this.controller.getAllRooms);
        this.router.post('/rooms', this.controller.createRoom);
        this.router.get('/room/active', this.controller.getActiveRoom);
        this.router.post('/rooms/:roomId/load', this.controller.loadRoom);
        
        // Guests
        this.router.get('/guests', this.controller.getActiveRoom); // Returns room + guests
        this.router.post('/guests', this.controller.addGuest);
        this.router.post('/guests/:slot/control', this.controller.controlGuest);
    }

    public getRouter(): Router {
        return this.router;
    }
}
