import { EventEmitter } from 'events';
import { Server as SocketServer } from 'socket.io';
import { DatabaseService } from './DatabaseService';
import { ILogger } from './LoggerService';

export interface GoalStyle {
    width_pct: number;
    bar_height_px: number;
    round_px: number;
    bg_mode: 'solid' | 'gradient';
    bg_color: string;
    bg_color2: string;
    bg_angle: number;
    bar_bg: string;
    fill_mode: 'solid' | 'gradient' | 'stripes';
    fill_color1: string;
    fill_color2: string;
    fill_angle: number;
    stripes_speed_s: number;
    stripes_alpha: number;
    border_enabled: boolean;
    border_color: string;
    border_width: number;
    shadow_enabled: boolean;
    shadow_css: string;
    font_family: string;
    font_url: string;
    text_color: string;
    text_size_px: number;
    letter_spacing_px: number;
    uppercase: boolean;
    label_pos: 'inside' | 'below';
    label_align: 'left' | 'center' | 'right';
    label_template: string;
    show_percent: boolean;
    show_goal_num: boolean;
    show_total_num: boolean;
    prefix_text: string;
    suffix_text: string;
    anim_duration_ms: number;
    pulse_on_full: boolean;
    confetti_on_goal: boolean;
}

export interface GoalConfig {
    name: string;
    goal: number;
    mode: 'add' | 'double' | 'hide';
    add_amount: number;
    show_goal: boolean;
    style: GoalStyle;
}

export interface GoalState {
    total: number;
    goal: number;
    show: boolean;
}

export const DEFAULT_STYLE: GoalStyle = {
    width_pct: 100, bar_height_px: 36, round_px: 18,
    bg_mode: 'solid', bg_color: '#002f00', bg_color2: '#004d00', bg_angle: 135, bar_bg: 'rgba(255,255,255,.15)',
    fill_mode: 'solid', fill_color1: '#4ade80', fill_color2: '#22c55e', fill_angle: 90, stripes_speed_s: 2.5, stripes_alpha: 0.25,
    border_enabled: false, border_color: 'rgba(255,255,255,.35)', border_width: 2, shadow_enabled: true, shadow_css: '0 10px 30px rgba(0,0,0,.25)',
    font_family: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif", font_url: '', text_color: '#ffffff', text_size_px: 20, letter_spacing_px: 0.5, uppercase: false,
    label_pos: 'below', label_align: 'center', label_template: '{total} / {goal} ({percent}%)',
    show_percent: true, show_goal_num: true, show_total_num: true, prefix_text: '', suffix_text: '',
    anim_duration_ms: 900, pulse_on_full: true, confetti_on_goal: true
};

export class GoalService extends EventEmitter {
    private state: Record<string, GoalState> = {
        likes: { total: 0, goal: 1000, show: true },
        followers: { total: 0, goal: 10, show: true },
        subs: { total: 0, goal: 5, show: true },
        coins: { total: 0, goal: 1000, show: true }
    };

    constructor(
        private readonly db: DatabaseService,
        private readonly io: SocketServer,
        private readonly logger: ILogger
    ) {
        super();
        this.loadState();
        this.logger.info('✅ GoalService initialized');
    }

    private loadState(): void {
        for (const key of Object.keys(this.state)) {
            const config = this.getGoalConfig(key);
            if (config) {
                this.state[key].goal = config.goal;
                this.state[key].show = config.show_goal;
            }
            const total = this.db.getSetting(`goal_${key}_total`);
            if (total !== null) this.state[key].total = parseInt(total) || 0;
        }
    }

    public getGoalConfig(key: string): GoalConfig | null {
        const raw = this.db.getSetting(`goal_${key}_config`);
        if (raw) {
            try { return JSON.parse(raw); } catch (e) { this.logger.error(`Error parsing goal config for ${key}:`, e); }
        }
        return null; // Should return defaults if null
    }

    public saveGoalConfig(key: string, config: GoalConfig): void {
        this.db.setSetting(`goal_${key}_config`, JSON.stringify(config));
    }

    public async setGoal(key: string, newTotal: number): Promise<void> {
        if (!this.state[key]) return;
        this.state[key].total = Math.max(0, newTotal);
        this.db.setSetting(`goal_${key}_total`, this.state[key].total.toString());
        await this.broadcastGoal(key);
        await this.applyGoalRules(key);
    }

    private async applyGoalRules(key: string): Promise<void> {
        const s = this.state[key];
        const config = this.getGoalConfig(key);
        if (!s.show || !config) return;

        if (s.total >= s.goal) {
            this.io.to(`goal_${key}`).emit('goal:reached', { key, total: s.total, goal: s.goal });
            if (config.mode === 'add') {
                while (s.total >= s.goal) s.goal += config.add_amount;
            } else if (config.mode === 'double') {
                while (s.total >= s.goal) s.goal *= 2;
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
        const updateData = {
            goalId: key, total: s.total, goal: s.goal, show: s.show,
            percent: Math.round((s.total / s.goal) * 100),
            style: config?.style || DEFAULT_STYLE,
            timestamp: Date.now()
        };
        this.io.to(`goal_${key}`).emit('goal:update', updateData);
        this.io.to('goals').emit('goals:update', updateData);
    }
}
