import { EventEmitter } from 'events';
import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export interface VDONinjaRoom {
    id: number;
    room_name: string;
    room_id: string;
    password?: string;
    max_guests: number;
    created_at: string;
    last_used: string;
}

export interface VDONinjaGuest {
    id: number;
    room_id: number;
    slot_number: number;
    stream_id?: string;
    guest_name?: string;
    is_connected: boolean;
    audio_enabled: boolean;
    video_enabled: boolean;
    volume: number;
    joined_at?: string;
}

/**
 * VDO.Ninja Manager - Handles multi-guest rooms and event broadcasting
 */
export class VDONinjaService extends EventEmitter {
    private currentRoom: VDONinjaRoom | null = null;
    private guests: Map<number, VDONinjaGuest> = new Map();

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer,
        private readonly logger: ILogger
    ) {
        super();
        this.logger.info('✅ VDONinjaService initialized');
    }

    /**
     * Create and initialize a new VDO.Ninja room
     */
    public async createRoom(name: string, roomId: string, password?: string, maxGuests: number = 6): Promise<VDONinjaRoom> {
        try {
            const id = this.db.createVDONinjaRoom(name, roomId, password, maxGuests);
            const room = this.db.getVDONinjaRoom(roomId);
            this.currentRoom = room;
            this.guests.clear();
            
            this.logger.info(`[VDONinja] Created room: ${name} (${roomId})`);
            this.io.emit('vdoninja:room_created', room);
            
            return room;
        } catch (error) {
            this.logger.error('[VDONinja] Failed to create room:', error);
            throw error;
        }
    }

    /**
     * Join an existing room
     */
    public async joinRoom(roomId: string): Promise<VDONinjaRoom | null> {
        const room = this.db.getVDONinjaRoom(roomId);
        if (room) {
            this.currentRoom = room;
            this.loadGuests();
            this.db.updateVDONinjaRoom(room.id, { last_used: new Date().toISOString() });
            this.logger.info(`[VDONinja] Joined room: ${room.room_name} (${roomId})`);
            this.io.emit('vdoninja:room_joined', room);
            return room;
        }
        return null;
    }

    /**
     * Load guests for the current room
     */
    private loadGuests(): void {
        if (!this.currentRoom) return;
        const guestList = this.db.getGuestsByRoom(this.currentRoom.id);
        this.guests.clear();
        guestList.forEach(guest => {
            this.guests.set(guest.slot_number, {
                ...guest,
                is_connected: Boolean(guest.is_connected),
                audio_enabled: Boolean(guest.audio_enabled),
                video_enabled: Boolean(guest.video_enabled)
            });
        });
    }

    /**
     * Add or update a guest in a slot
     */
    public addGuest(slot: number, streamId: string, name: string): VDONinjaGuest {
        if (!this.currentRoom) throw new Error('No active room');
        
        // Check if guest exists in slot
        const existing = Array.from(this.guests.values()).find(g => g.slot_number === slot);
        if (existing) {
            this.db.run('UPDATE vdoninja_guests SET stream_id = ?, guest_name = ?, is_connected = 1 WHERE id = ?', streamId, name, existing.id);
        } else {
            this.db.addGuest(this.currentRoom.id, slot, streamId, name);
        }
        
        this.loadGuests();
        const guest = this.guests.get(slot)!;
        this.io.emit('vdoninja:guest_joined', guest);
        return guest;
    }

    /**
     * Remove guest from slot
     */
    public removeGuest(slot: number): void {
        const guest = this.guests.get(slot);
        if (guest) {
            this.db.removeGuest(guest.id);
            this.guests.delete(slot);
            this.io.emit('vdoninja:guest_left', { slot });
        }
    }

    /**
     * Update guest status (audio/video/volume)
     */
    public updateGuest(slot: number, updates: Partial<VDONinjaGuest>): void {
        const guest = this.guests.get(slot);
        if (guest) {
            const dbUpdates: any = {};
            if (updates.audio_enabled !== undefined) dbUpdates.audio_enabled = updates.audio_enabled ? 1 : 0;
            if (updates.video_enabled !== undefined) dbUpdates.video_enabled = updates.video_enabled ? 1 : 0;
            if (updates.volume !== undefined) dbUpdates.volume = updates.volume;
            
            if (Object.keys(dbUpdates).length > 0) {
                this.db.run(`UPDATE vdoninja_guests SET ${Object.keys(dbUpdates).map(k => `${k} = ?`).join(', ')} WHERE id = ?`, ...Object.values(dbUpdates), guest.id);
                this.loadGuests();
                this.io.emit('vdoninja:guest_updated', this.guests.get(slot));
            }
        }
    }

    /**
     * Broadcast a message to all guests or specific guest
     */
    public broadcast(message: any, slot?: number): void {
        if (slot !== undefined) {
            const guest = this.guests.get(slot);
            if (guest && guest.stream_id) {
                this.io.emit(`vdoninja:msg:${guest.stream_id}`, message);
            }
        } else {
            this.io.emit('vdoninja:broadcast', message);
        }
    }

    public getCurrentRoom(): VDONinjaRoom | null {
        return this.currentRoom;
    }

    public getGuests(): VDONinjaGuest[] {
        return Array.from(this.guests.values());
    }
}
