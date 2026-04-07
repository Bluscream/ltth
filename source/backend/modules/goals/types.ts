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

export interface GoalUpdate {
    type: 'goal';
    goalId: string;
    total: number;
    goal: number;
    show: boolean;
    pct: number;
    percent: number;
    style: GoalStyle;
    timestamp: number;
}
