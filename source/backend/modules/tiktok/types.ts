export interface TikTokStats {
    viewers: number;
    likes: number;
    totalCoins: number;
    followers: number;
    shares: number;
    gifts: number;
}

export interface UserData {
    username: string;
    nickname: string;
    userId: string;
    profilePictureUrl: string;
    teamMemberLevel: number;
    isModerator: boolean;
    isSubscriber: boolean;
}

export interface GiftData {
    giftId: number | null;
    giftName: string | null;
    diamondCount: number;
    giftPictureUrl: string | null;
    repeatCount: number;
    repeatEnd: boolean;
    giftType: number;
    userId: string;
    username: string;
    nickname: string;
    profilePictureUrl: string;
    timestamp: string;
}

export interface ChatEvent {
    username: string;
    nickname: string;
    message: string;
    userId: string;
    profilePictureUrl: string;
    teamMemberLevel: number;
    isModerator: boolean;
    isSubscriber: boolean;
    timestamp: string;
}

export interface RoomInfo {
    roomId: string;
    ownerUserId: string;
    title: string;
    userCount: number;
    totalUser: number;
    likeCount: number;
    shareCount: number;
    startTime?: number | string;
    status: number;
}

export interface StreamTimeInfo {
    streamStartTime: number | null;
    streamStartISO: string;
    detectionMethod: string;
    currentDuration: number;
}
