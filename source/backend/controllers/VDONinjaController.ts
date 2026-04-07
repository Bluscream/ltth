import { Request, Response } from 'express';
import { BaseController } from '../modules/BaseController';
import { VDONinjaService } from '../modules/VDONinjaService';
import { ILogger } from '../modules/LoggerService';

/**
 * VDO.Ninja Controller - Handles HTTP requests for VDO.Ninja management
 */
export class VDONinjaController extends BaseController {
    constructor(
        private readonly vdoNinjaService: VDONinjaService,
        logger: ILogger
    ) {
        super(logger);
    }

    /**
     * GET /api/vdoninja/rooms
     * List all rooms
     */
    public getAllRooms = async (req: Request, res: Response): Promise<void> => {
        try {
            // Need to implement getAllRooms in VDONinjaService or use DB directly
            // For now, using the service's DB
            const rooms = (this.vdoNinjaService as any).db.all('SELECT * FROM vdoninja_rooms ORDER BY last_used DESC');
            this.sendSuccess(res, { rooms });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/vdoninja/rooms
     * Create a new room
     */
    public createRoom = async (req: Request, res: Response): Promise<void> => {
        try {
            const { roomName, roomId, password, maxGuests } = req.body;
            const room = await this.vdoNinjaService.createRoom(roomName, roomId || roomName, password, maxGuests);
            this.sendSuccess(res, { room });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/vdoninja/rooms/:roomId/load
     * Load an existing room
     */
    public loadRoom = async (req: Request, res: Response): Promise<void> => {
        try {
            const { roomId } = req.params;
            const room = await this.vdoNinjaService.joinRoom(roomId);
            if (room) {
                this.sendSuccess(res, { room });
            } else {
                this.sendError(res, 'Room not found', 'Not Found', 404);
            }
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * GET /api/vdoninja/room/active
     * Get the active room status
     */
    public getActiveRoom = async (req: Request, res: Response): Promise<void> => {
        try {
            const activeRoom = this.vdoNinjaService.getCurrentRoom();
            const guests = this.vdoNinjaService.getGuests();
            this.sendSuccess(res, { room: activeRoom, guests });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/vdoninja/guests
     * Add a guest to the current room
     */
    public addGuest = async (req: Request, res: Response): Promise<void> => {
        try {
            const { slot, streamId, guestName } = req.body;
            const guest = this.vdoNinjaService.addGuest(slot, streamId, guestName);
            this.sendSuccess(res, { guest });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };

    /**
     * POST /api/vdoninja/guests/:slot/control
     * Control guest (mute/volume/etc)
     */
    public controlGuest = async (req: Request, res: Response): Promise<void> => {
        try {
            const slot = parseInt(req.params.slot);
            const { action, ...params } = req.body;

            switch (action) {
                case 'mute':
                case 'unmute':
                    this.vdoNinjaService.updateGuest(slot, {
                        audio_enabled: params.audioEnabled !== undefined ? params.audioEnabled : (action === 'unmute'),
                        video_enabled: params.videoEnabled !== undefined ? params.videoEnabled : (action === 'unmute')
                    });
                    break;
                case 'volume':
                    this.vdoNinjaService.updateGuest(slot, { volume: params.volume });
                    break;
                case 'remove':
                    this.vdoNinjaService.removeGuest(slot);
                    break;
                default:
                    return this.sendError(res, `Unknown action: ${action}`, 'Bad Request', 400);
            }

            this.sendSuccess(res, { success: true });
        } catch (error: any) {
            this.sendError(res, error.message);
        }
    };
}
