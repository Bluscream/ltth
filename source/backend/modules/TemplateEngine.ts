/**
 * Template Engine with Variable Replacement and RegExp Caching
 * Eliminates code duplication and improves performance
 */

export interface TemplateOptions {
    htmlEscape?: boolean;
    defaultValue?: string;
}

export interface TikTokEventData {
    uniqueId?: string;
    nickname?: string;
    username?: string;
    giftName?: string;
    giftCount?: number;
    repeatCount?: number;
    coins?: number;
    diamondCount?: number;
    message?: string;
    comment?: string;
    likeCount?: number;
    totalLikeCount?: number;
    followRole?: string;
    shareType?: string;
    viewerCount?: number;
    teamMemberLevel?: number;
}

export class TemplateEngine {
    private regexpCache: Map<string, RegExp>;
    private maxCacheSize: number;
    private commonVariables: Record<string, string>;

    constructor() {
        // Cache for compiled RegExp patterns
        this.regexpCache = new Map();
        this.maxCacheSize = 1000;

        // Predefined common variables for TikTok events
        this.commonVariables = {
            'username': 'User',
            'uniqueId': 'user123',
            'nickname': 'User',
            'giftName': 'Rose',
            'giftCount': '1',
            'coins': '5',
            'diamondCount': '5',
            'message': 'Hello!',
            'comment': 'Nice stream!',
            'likeCount': '1',
            'totalLikes': '100',
            'followRole': 'follower',
            'viewerCount': '10',
            'teamMemberLevel': '1'
        };
    }

    /**
     * Get cached RegExp or create and cache new one
     * @param variable - Variable name to create pattern for
     * @returns Compiled RegExp pattern
     */
    private getRegExp(variable: string): RegExp {
        if (this.regexpCache.has(variable)) {
            return this.regexpCache.get(variable)!;
        }

        // Create new RegExp
        const pattern = new RegExp(`\\{${variable}\\}`, 'g');

        // Cache size limit
        if (this.regexpCache.size >= this.maxCacheSize) {
            // Remove oldest entry (simple FIFO)
            const firstKey = this.regexpCache.keys().next().value;
            if (firstKey) this.regexpCache.delete(firstKey);
        }

        this.regexpCache.set(variable, pattern);
        return pattern;
    }

    /**
     * Replace variables in template string
     * @param template - Template string with {variable} placeholders
     * @param variables - Object with variable values
     * @param options - Rendering options
     * @returns Rendered template
     */
    render(template: string, variables: Record<string, any> = {}, options: TemplateOptions = {}): string {
        const { htmlEscape = false, defaultValue = '' } = options;

        if (!template || typeof template !== 'string') {
            return template;
        }

        let result = template;

        // Replace all variables
        for (const [key, value] of Object.entries(variables)) {
            if (value === null || value === undefined) {
                continue;
            }

            const regexp = this.getRegExp(key);
            let replacement = String(value);

            // HTML escape if requested
            if (htmlEscape) {
                replacement = this.escapeHtml(replacement);
            }

            result = result.replace(regexp, replacement);
        }

        // Replace remaining variables with default value
        if (defaultValue !== '') {
            result = result.replace(/\{[a-zA-Z0-9_]+\}/g, defaultValue);
        }

        return result;
    }

    /**
     * Render template for TikTok events
     * @param template - Template string
     * @param eventData - TikTok event data
     * @param options - Rendering options
     * @returns Rendered template
     */
    renderTikTokEvent(template: string, eventData: TikTokEventData = {}, options: TemplateOptions = {}): string {
        // Build variables from event data
        const variables: Record<string, any> = {};

        // Event-specific variable extraction
        if (eventData.uniqueId) variables.uniqueId = eventData.uniqueId;
        if (eventData.nickname) variables.nickname = eventData.nickname;
        if (eventData.username) variables.username = eventData.username;

        // Gift events
        if (eventData.giftName) variables.giftName = eventData.giftName;
        if (eventData.giftCount !== undefined) variables.giftCount = eventData.giftCount;
        if (eventData.repeatCount !== undefined) variables.giftCount = eventData.repeatCount;
        if (eventData.coins !== undefined) variables.coins = eventData.coins;
        if (eventData.diamondCount !== undefined) variables.diamondCount = eventData.diamondCount;

        // Chat/Comment events
        if (eventData.message) variables.message = eventData.message;
        if (eventData.comment) variables.comment = eventData.comment;

        // Like events
        if (eventData.likeCount !== undefined) variables.likeCount = eventData.likeCount;
        if (eventData.totalLikeCount !== undefined) variables.totalLikes = eventData.totalLikeCount;

        // Follow events
        if (eventData.followRole !== undefined) variables.followRole = eventData.followRole;

        // Share events
        if (eventData.shareType) variables.shareType = eventData.shareType;

        // Viewer count
        if (eventData.viewerCount !== undefined) variables.viewerCount = eventData.viewerCount;

        // Team member level
        if (eventData.teamMemberLevel !== undefined) variables.teamMemberLevel = eventData.teamMemberLevel;

        return this.render(template, variables, options);
    }

    /**
     * Render template for gift events
     * @param template - Template string
     * @param gift - Gift event data
     * @returns Rendered template
     */
    renderGiftEvent(template: string, gift: any = {}): string {
        const variables = {
            username: gift.uniqueId || gift.username || 'User',
            nickname: gift.nickname || gift.uniqueId || 'User',
            giftName: gift.giftName || 'Gift',
            giftCount: gift.giftCount || gift.repeatCount || 1,
            coins: gift.coins || gift.diamondCount || 0,
            diamondCount: gift.diamondCount || gift.coins || 0
        };

        return this.render(template, variables);
    }

    /**
     * Render template for alert events
     * @param template - Template string
     * @param eventType - Event type (gift, follow, share, etc.)
     * @param data - Event data
     * @returns Rendered template
     */
    renderAlertEvent(template: string, eventType: string, data: any = {}): string {
        const variables: Record<string, any> = {
            eventType: eventType,
            username: data.uniqueId || data.username || 'User',
            nickname: data.nickname || data.uniqueId || 'User'
        };

        // Add event-specific variables
        switch (eventType) {
            case 'gift':
                variables.giftName = data.giftName || 'Gift';
                variables.giftCount = data.giftCount || data.repeatCount || 1;
                variables.coins = data.coins || data.diamondCount || 0;
                break;
            case 'chat':
            case 'comment':
                variables.message = data.message || data.comment || '';
                break;
            case 'like':
                variables.likeCount = data.likeCount || 1;
                variables.totalLikes = data.totalLikeCount || 0;
                break;
            case 'share':
                variables.shareType = data.shareType || 'share';
                break;
            case 'follow':
                variables.followRole = data.followRole || 'follower';
                break;
        }

        return this.render(template, variables);
    }

    /**
     * Escape HTML special characters
     * @param text - Text to escape
     * @returns Escaped text
     */
    escapeHtml(text: string): string {
        const htmlEscapeMap: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;'
        };

        return text.replace(/[&<>"'/]/g, char => htmlEscapeMap[char]);
    }

    /**
     * Check if template contains variable
     * @param template - Template string
     * @param variable - Variable name
     * @returns True if template contains variable
     */
    hasVariable(template: string, variable: string): boolean {
        return template.includes(`{${variable}}`);
    }

    /**
     * Get all variables in template
     * @param template - Template string
     * @returns Array of variable names
     */
    getVariables(template: string): string[] {
        const matches = template.match(/\{([a-zA-Z0-9_]+)\}/g);
        if (!matches) {
            return [];
        }

        return matches.map(match => match.slice(1, -1));
    }

    /**
     * Validate template syntax
     * @param template - Template string
     * @returns Validation result
     */
    validateTemplate(template: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (typeof template !== 'string') {
            errors.push('Template must be a string');
            return { valid: false, errors };
        }

        // Check for unclosed braces
        const openBraces = (template.match(/\{/g) || []).length;
        const closeBraces = (template.match(/\}/g) || []).length;

        if (openBraces !== closeBraces) {
            errors.push(`Mismatched braces: ${openBraces} open, ${closeBraces} close`);
        }

        // Check for nested braces (not supported)
        if (/\{\{|\}\}/.test(template)) {
            errors.push('Nested braces are not supported');
        }

        // Check for invalid variable names
        const invalidVars = template.match(/\{[^a-zA-Z0-9_]+\}/g);
        if (invalidVars) {
            errors.push(`Invalid variable names: ${invalidVars.join(', ')}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Clear RegExp cache
     */
    clearCache(): void {
        this.regexpCache.clear();
    }

    /**
     * Get cache statistics
     * @returns Cache stats
     */
    getCacheStats(): { size: number; maxSize: number; keys: string[] } {
        return {
            size: this.regexpCache.size,
            maxSize: this.maxCacheSize,
            keys: Array.from(this.regexpCache.keys())
        };
    }
}

// Export singleton instance
export const templateEngine = new TemplateEngine();
