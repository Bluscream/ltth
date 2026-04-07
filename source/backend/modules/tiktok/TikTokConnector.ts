import { EventEmitter } from 'events';
import WebSocket from 'ws';
import axios from 'axios';
import { 
    WebcastEventEmitter, 
    createWebSocketUrl, 
    ClientCloseCode, 
    deserializeWebSocketMessage, 
    SchemaVersion 
} from '@eulerstream/euler-websocket-sdk';
import { ILogger } from '../LoggerService';
import { DatabaseService } from '../DatabaseService';
import { StatsManager } from './StatsManager';
import { EventMapper } from './EventMapper';
import { TikTokStats, UserData, GiftData, ChatEvent, RoomInfo } from './types';

export class TikTokConnector extends EventEmitter {
    private ws: WebSocket | null = null;
    private eventEmitter: WebcastEventEmitter | null = null;
    private isConnected: boolean = false;
    private currentUsername: string | null = null;
    private statsManager: StatsManager;
    private eventMapper: EventMapper;

    private autoReconnectCount: number = 0;
    private maxAutoReconnects: number = 5;
    private autoReconnectResetTimeout: NodeJS.Timeout | null = null;

    private streamStartTime: number | null = null;
    private durationInterval: NodeJS.Timeout | null = null;
    private statsPersistenceInterval: NodeJS.Timeout | null = null;
    private _earliestEventTime: number | null = null;
    private _persistedStreamStart: number | null = null;
    private _streamTimeDetectionMethod: string = '';

    private processedEvents: Map<string, number> = new Map();
    private _giftDedupeMap: Map<string, number> = new Map();
    private _giftDedupeTtlMs: number = 5000;

    constructor(
        private readonly io: any,
        private readonly db: DatabaseService,
        private readonly logger: ILogger
    ) {
        super();
        this.setMaxListeners(30);
        this.statsManager = new StatsManager(db, logger);
        this.eventMapper = new EventMapper(logger);
    }

    public async connect(username: string): Promise<void> {
        const previousUsername = this.currentUsername;
        
        if (this.isConnected) {
            await this.disconnect();
        }

        if (previousUsername && previousUsername !== username) {
            this.statsManager.resetStats();
            this._earliestEventTime = null;
            this.streamStartTime = null;
            this._persistedStreamStart = null;
            this.processedEvents.clear();
            this.logger.info(`🔄 Switching TikTok user to @${username}`);
        }

        try {
            this.currentUsername = username;
            const apiKey = this.db.getSetting('tiktok_euler_api_key') || process.env.EULER_API_KEY;

            if (!apiKey) {
                throw new Error('No Eulerstream API key configured');
            }

            const wsUrl = createWebSocketUrl({
                uniqueId: username,
                apiKey: apiKey
            });

            this.ws = new WebSocket(wsUrl);
            this.eventEmitter = new (WebcastEventEmitter as any)();

            this._setupWebSocketHandlers();

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 60000);
                this.ws!.once('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.ws!.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            this.isConnected = true;
            this.autoReconnectCount = 0;
            this.streamStartTime = null;
            this._streamTimeDetectionMethod = 'Waiting for data...';

            this.durationInterval = setInterval(() => this.broadcastStats(), 1000);
            this.statsPersistenceInterval = setInterval(() => this.statsManager.persist(), 30000);

            this.broadcastStatus('connected', { username });
            this.logger.info(`✅ Connected to TikTok: @${username}`);

        } catch (error: any) {
            this.isConnected = false;
            this.logger.error(`❌ Connection failed: ${error.message}`);
            this.broadcastStatus('error', { error: error.message });
            throw error;
        }
    }

    public isActive(): boolean {
        return this.isConnected;
    }

    public async disconnect(): Promise<void> {
        this.isConnected = false;
        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }
        if (this.durationInterval) clearInterval(this.durationInterval);
        if (this.statsPersistenceInterval) clearInterval(this.statsPersistenceInterval);
        this.broadcastStatus('disconnected');
    }

    private _setupWebSocketHandlers(): void {
        if (!this.ws || !this.eventEmitter) return;

        this.ws.on('close', (code, reason) => {
            this.isConnected = false;
            const reasonStr = reason.toString();
            this.logger.info(`🔴 WebSocket closed: ${code} - ${reasonStr}`);
            
            if (code === 4005) {
                this.broadcastStatus('stream_ended');
                return;
            }

            if (this.autoReconnectCount < this.maxAutoReconnects) {
                this.autoReconnectCount++;
                const delay = Math.min(5000 * this.autoReconnectCount, 30000);
                setTimeout(() => this.connect(this.currentUsername!), delay);
            }
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                const text = data.toString('utf-8');
                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = deserializeWebSocketMessage(new Uint8Array(data), (SchemaVersion as any).v2 || (SchemaVersion as any).V2);
                }

                if (parsed && parsed.messages) {
                    for (const msg of parsed.messages) {
                        this._processMessage(msg);
                    }
                }
            } catch (err: any) {
                this.logger.error('Failed to process message:', err.message);
            }
        });

        this._registerEvents();
    }

    private _processMessage(msg: any): void {
        if (msg.type === 'roomInfo') {
            this._handleRoomInfo(msg.data);
            return;
        }

        const internalEvent = this.eventMapper.mapEulerStreamEventType(msg.type);
        if (internalEvent && this.eventEmitter) {
            (this.eventEmitter as any).emit(internalEvent, msg.data);
        }
    }

    private _handleRoomInfo(data: any): void {
        const timestamp = this._extractStreamStartTime(data);
        if (!this.streamStartTime || timestamp < this.streamStartTime) {
            this.streamStartTime = timestamp;
            this._streamTimeDetectionMethod = 'roomInfo';
        }
        // Extract stats from roomInfo could go here or in StatsManager
    }

    private _extractStreamStartTime(data: any): number {
        // Complex logic from original JS goes here
        return Date.now(); 
    }

    private _registerEvents(): void {
        if (!this.eventEmitter) return;

        (this.eventEmitter as any).on('chat', (data: any) => {
            const chatEvent = this.eventMapper.extractUserData(data) as any;
            chatEvent.message = data.comment || data.message;
            chatEvent.timestamp = new Date().toISOString();

            if (this._shouldProcessEvent('chat', chatEvent)) {
                this.io.emit('tiktok:chat', chatEvent);
                this.db.logEvent('chat', chatEvent.username, chatEvent);
            }
        });

        (this.eventEmitter as any).on('gift', (data: any) => {
            const giftData = this.eventMapper.extractGiftData(data);
            if (this._shouldProcessGift(giftData)) {
                this.statsManager.addCoins(giftData.diamondCount);
                this.statsManager.addGifts(1);
                this.io.emit('tiktok:gift', giftData);
                this.db.logEvent('gift', giftData.username, giftData);
            }
        });
        
        // Add other events here...
    }

    private _shouldProcessEvent(type: string, data: any): boolean {
        // Implementation of event deduplication logic
        return true;
    }

    private _shouldProcessGift(gift: GiftData): boolean {
        if (!gift.giftName && gift.diamondCount === 0) return false;
        // Implementation of gift deduplication logic
        return true;
    }

    private broadcastStats(): void {
        const stats = this.statsManager.getStats();
        this.io.emit('tiktok:stats', stats);
    }

    private broadcastStatus(status: string, data: any = {}): void {
        this.io.emit('tiktok:status', { status, ...data });
    }
}
