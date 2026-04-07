export interface AlertConfig {
    event_type: string;
    sound_file: string | null;
    sound_volume: number;
    text_template: string;
    duration: number;
    enabled: boolean;
}

export interface Alert {
    type: string;
    data: any;
    text: string;
    soundFile: string | null;
    soundVolume: number;
    duration: number;
    image: string | null;
    timestamp: number;
}
