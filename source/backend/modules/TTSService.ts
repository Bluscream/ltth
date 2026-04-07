import { ILogger } from './LoggerService';

export interface SpeakOptions {
    text: string;
    voice?: string;
    volume?: number;
    rate?: number;
}

/**
 * TTSService - Text-to-Speech service for narrating stream events
 */
export class TTSService {
    private isSpeaking = false;
    private queue: SpeakOptions[] = [];

    constructor(private readonly logger: ILogger) {}

    public async speak(options: SpeakOptions): Promise<void> {
        this.logger.info(`🗣️ TTS: ${options.text}`);
        this.queue.push(options);
        
        if (!this.isSpeaking) {
            await this.processQueue();
        }
    }

    private async processQueue(): Promise<void> {
        if (this.queue.length === 0) {
            this.isSpeaking = false;
            return;
        }

        this.isSpeaking = true;
        const next = this.queue.shift();
        
        if (next) {
            try {
                // In a real browser/Electron env, this would use window.speechSynthesis
                // or a native binding. For now, we simulate the delay.
                await new Promise(resolve => setTimeout(resolve, 1000 + next.text.length * 50));
            } catch (error: any) {
                this.logger.error('TTS execution error:', error);
            }
        }

        await this.processQueue();
    }

    public stop(): void {
        this.queue = [];
        this.isSpeaking = false;
    }
}
