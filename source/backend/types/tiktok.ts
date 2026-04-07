/**
 * TikTok User Metadata
 */
export interface TikTokUser {
    userId: string;
    username: string;
    nickname: string;
    profilePictureUrl: string;
    followInfo?: {
        followingCount: number;
        followerCount: number;
        followStatus: number;
        pushStatus: number;
    };
    isModerator?: boolean;
    isNewGifter?: boolean;
    isSubscriber?: boolean;
    topGifter?: boolean;
    teamMemberLevel?: number;
}

/**
 * TikTok Chat Event
 */
export interface ChatEvent {
    userId: string;
    username: string;
    nickname: string;
    profilePictureUrl: string;
    message: string;
    timestamp: string;
    isModerator?: boolean;
    isSubscriber?: boolean;
    teamMemberLevel?: number;
}

/**
 * TikTok Gift Event
 */
export interface GiftEvent {
    userId: string;
    username: string;
    nickname: string;
    profilePictureUrl: string;
    giftId: number | string;
    giftName: string;
    giftPictureUrl: string;
    diamondCount: number;
    repeatCount: number;
    repeatEnd: boolean;
    timestamp: string;
    teamMemberLevel?: number;
}

/**
 * TikTok Stream Statistics
 */
export interface StreamStats {
    viewers: number;
    likes: number;
    totalCoins: number;
    followers: number;
    shares: number;
    gifts: number;
    streamStartTime?: number;
}

/**
 * TikTok Connection Status
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'not_live' | 'stream_ended';

/**
 * Generic TikTok Event
 */
export type TikTokEvent = ChatEvent | GiftEvent;

/**
 * Backwards compatibility for GiftData
 */
export type GiftData = GiftEvent;
