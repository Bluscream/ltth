import { ChatEvent, GiftData, UserData } from './types';
import { ILogger } from '../LoggerService';

export class EventMapper {
    constructor(private readonly logger: ILogger) {}

    public extractUserData(data: any): UserData {
        const user = data.user || data;
        return {
            username: user.uniqueId || user.username || 'unknown',
            nickname: user.nickname || 'unknown',
            userId: user.userId || 'unknown',
            profilePictureUrl: user.profilePictureUrl || user.avatarThumb || '',
            teamMemberLevel: data.teamMemberLevel || 0,
            isModerator: !!data.isModerator,
            isSubscriber: !!data.isSubscriber
        };
    }

    public extractGiftData(data: any): GiftData {
        const userData = this.extractUserData(data);
        return {
            giftId: data.giftId || null,
            giftName: data.giftName || null,
            diamondCount: parseInt(data.diamondCount || 0, 10),
            giftPictureUrl: data.giftPictureUrl || null,
            repeatCount: parseInt(data.repeatCount || 1, 10),
            repeatEnd: !!data.repeatEnd,
            giftType: data.giftType || 0,
            userId: userData.userId,
            username: userData.username,
            nickname: userData.nickname,
            profilePictureUrl: userData.profilePictureUrl,
            timestamp: new Date().toISOString()
        };
    }

    public mapEulerStreamEventType(eulerType: string): string | null {
        const mapping: Record<string, string> = {
            'WebcastChatMessage': 'chat',
            'WebcastGiftMessage': 'gift',
            'WebcastSocialMessage': 'social',
            'WebcastLikeMessage': 'like',
            'WebcastMemberMessage': 'member',
            'WebcastRoomUserSeqMessage': 'roomUser',
            'WebcastSubscribeMessage': 'subscribe',
            'WebcastShareMessage': 'share',
            'WebcastQuestionNewMessage': 'question',
            'WebcastLinkMicBattle': 'linkMicBattle',
            'WebcastLinkMicArmies': 'linkMicArmies',
            'WebcastEmoteChatMessage': 'emote'
        };
        
        return mapping[eulerType] || null;
    }
}
