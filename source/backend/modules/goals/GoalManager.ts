import { EventEmitter } from 'events';
import { Server } from 'socket.io';
import { DatabaseService } from '../DatabaseService';
import { ILogger } from '../LoggerService';
import { GoalConfig, GoalState, GoalStyle } from './types';

export const DEFAULT_STYLE: GoalStyle = {
    width_pct: 100,
    bar_height_px: 36,
    round_px: 18,
    bg_mode: 'solid',
    bg_color: '#002f00',
    bg_color2: '#004d00',
    bg_angle: 135,
    bar_bg: 'rgba(255,255,255,.15)',
    fill_mode: 'solid',
    fill_color1: '#4ade80',
    fill_color2: '#22c55e',
    fill_angle: 90,
    stripes_speed_s: 2.5,
    stripes_alpha: 0.25,
    border_enabled: false,
    border_color: 'rgba(255,255,255,.35)',
    border_width: 2,
    shadow_enabled: true,
    shadow_css: '0 10px 30px rgba(0,0,0,.25)',
    font_family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
    font_url: '',
    text_color: '#ffffff',
    text_size_px: 20,
    letter_spacing_px: 0.5,
    uppercase: false,
    label_pos: 'below',
    label_align: 'center',
    label_template: '{total} / {goal} ({percent}%)',
    show_percent: true,
    show_goal_num: true,
    show_total_num: true,
    prefix_text: '',
    suffix_text: '',
    anim_duration_ms: 900,
    pulse_on_full: true,
    confetti_on_goal: true
};

export const DEFAULT_GOALS: Record<string, GoalConfig> = {
    likes: { 
        name: 'Likes', 
        goal: 1000, 
        mode: 'add', 
        add_amount: 1000, 
        show_goal: true, 
        style: { ...DEFAULT_STYLE, label_template: 'Likes: {total} / {goal} ({percent}%)' } 
    },
    followers: { 
        name: 'Follower', 
        goal: 10, 
        mode: 'add', 
        add_amount: 10, 
        show_goal: true, 
        style: { ...DEFAULT_STYLE, label_template: 'Follower: {total} / {goal}', show_percent: false, fill_color1: '#60a5fa', fill_color2: '#3b82f6' } 
    },
    subs: { 
        name: 'Subscriber', 
        goal: 5, 
        mode: 'add', 
        add_amount: 5, 
        show_goal: true, 
        style: { ...DEFAULT_STYLE, label_template: 'Subscriber: {total} / {goal}', show_percent: false, fill_color1: '#f472b6', fill_color2: '#ec4899' } 
    },
    coins: { 
        name: 'Coins', 
        goal: 1000, 
        mode: 'add', 
        add_amount: 1000, 
        show_goal: true, 
        style: { ...DEFAULT_STYLE, label_template: 'Coins: {total} / {goal} ({percent}%)', fill_color1: '#fbbf24', fill_color2: '#f59e0b' } 
    }
};

export class GoalManager extends EventEmitter {
    private state: Record<string, GoalState> = {
        likes: { total: 0, goal: 1000, show: true },
        followers: { total: 0, goal: 10, show: true },
        subs: { total: 0, goal: 5, show: true },
        coins: { total: 0, goal: 1000, show: true }
    };

    constructor(
        private readonly db: DatabaseService,
        private readonly io: Server,
        private readonly logger: ILogger
    ) {
        super();
        this.loadState();
        this.logger.info('✅ Goal Manager: Initialized');
    }

    private loadState(): void {
        for (const key of Object.keys(DEFAULT_GOALS)) {
            const config = this.getGoalConfig(key);
            if (config) {
                this.state[key].goal = config.goal;
                this.state[key].show = config.show_goal;
            }

            const total = this.db.getSetting(`goal_${key}_total`);
            if (total !== null) {
                this.state[key].total = parseInt(total, 10) || 0;
            }
        }
    }

    public getGoalConfig(key: string): GoalConfig | null {
        try {
            const raw = this.db.getSetting(`goal_${key}_config`);
            if (raw) return JSON.parse(raw);
        } catch (e: any) {
            this.logger.error(`Error parsing goal config for ${key}: ${e.message}`);
        }
        return DEFAULT_GOALS[key] || null;
    }

    private saveGoalConfig(key: string, config: GoalConfig): void {
        this.db.setSetting(`goal_${key}_config`, JSON.stringify(config));
    }

    private saveTotal(key: string): void {
        this.db.setSetting(`goal_${key}_total`, this.state[key].total.toString());
    }

    public async setGoal(key: string, newTotal: number): Promise<void> {
        if (!this.state[key]) return;

        this.state[key].total = Math.max(0, newTotal);
        this.saveTotal(key);

        await this.broadcastGoal(key);
        await this.applyGoalRules(key);
    }

    public async applyGoalRules(key: string): Promise<void> {
        const s = this.state[key];
        const config = this.getGoalConfig(key);
        if (!s.show || !config) return;

        if (s.total >= s.goal) {
            this.io.to(`goal_${key}`).emit('goal:reached', { key, total: s.total, goal: s.goal });

            if (config.mode === 'add') {
                const increment = Math.max(1, config.add_amount || 10);
                while (s.total >= s.goal) {
                    s.goal += increment;
                }
            } else if (config.mode === 'double') {
                while (s.total >= s.goal) {
                    s.goal = Math.max(1, s.goal * 2);
                }
            } else if (config.mode === 'hide') {
                s.show = false;
                config.show_goal = false;
            }

            config.goal = s.goal;
            this.saveGoalConfig(key, config);
            await this.broadcastGoal(key);
        }
    }

    public async broadcastGoal(key: string): Promise<void> {
        const s = this.state[key];
        const config = this.getGoalConfig(key);
        const pct = s.goal <= 0 ? 0 : Math.max(0, Math.min(1, s.total / s.goal));

        const updateData = {
            type: 'goal',
            goalId: key,
            total: s.total,
            goal: s.goal,
            show: s.show,
            pct,
            percent: Math.round(pct * 100),
            style: config ? config.style : DEFAULT_GOALS[key].style,
            timestamp: Date.now()
        };

        this.io.to(`goal_${key}`).emit('goal:update', updateData);
        this.io.to('goals').emit('goals:update', updateData);
    }
}
