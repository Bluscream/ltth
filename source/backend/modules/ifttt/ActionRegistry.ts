import dns from 'dns';
import { promisify } from 'util';
import { ILogger } from '../LoggerService';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

// SSRF Protections
const DEFAULT_ALLOWED_WEBHOOK_DOMAINS = [
    'webhook.site', 'discord.com', 'zapier.com', 'ifttt.com', 'make.com', 'integromat.com'
];

const BLOCKED_IP_PATTERNS = [
    '127.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
    '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
    '192.168.', '169.254.', '0.', '224.', 'localhost', '::1', 'fe80:', 'fc00:', 'fd00:'
];

export interface ActionField {
    name: string;
    label: string;
    type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'range' | 'file' | 'color';
    required?: boolean;
    default?: any;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    accept?: string;
}

export interface ActionConfig {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    fields: ActionField[];
    executor: (action: any, context: any, services: any) => Promise<any>;
    metadata?: Record<string, any>;
}

/**
 * ActionRegistry - Central registry for all available actions
 */
export class ActionRegistry {
    private logger: ILogger;
    private actions: Map<string, ActionConfig> = new Map();

    constructor(logger: ILogger = console) {
        this.logger = logger;
        this.registerCoreActions();
    }

    public register(id: string, config: ActionConfig): void {
        this.actions.set(id, config);
    }

    public get(id: string): ActionConfig | undefined {
        return this.actions.get(id);
    }

    public getAll(): ActionConfig[] {
        return Array.from(this.actions.values());
    }

    public async execute(actionDef: any, context: any, services: any): Promise<any> {
        const action = this.actions.get(actionDef.type);
        if (!action) throw new Error(`Unknown action type: ${actionDef.type}`);
        return await action.executor(actionDef, context, services);
    }

    private async validateWebhookUrl(url: string, allowedDomains: string[]): Promise<void> {
        const urlObj = new URL(url);
        const host = urlObj.hostname.toLowerCase();

        if (BLOCKED_IP_PATTERNS.some(p => host.startsWith(p))) {
            throw new Error(`Restricted host blocked: ${host}`);
        }

        if (!allowedDomains.includes(host) && !allowedDomains.some(d => host.endsWith('.' + d))) {
            throw new Error(`Domain not in whitelist: ${host}`);
        }

        try {
            const ips = await Promise.all([
                resolve4(host).catch(() => []),
                resolve6(host).catch(() => [])
            ]);
            for (const ip of ips.flat()) {
                if (BLOCKED_IP_PATTERNS.some(p => ip.startsWith(p))) {
                    throw new Error(`Host resolves to restricted IP: ${ip}`);
                }
            }
        } catch (e: any) {
            if (e.message.includes('restricted IP')) throw e;
        }
    }

    private registerCoreActions(): void {
        this.register('tts:speak', {
            id: 'tts:speak',
            name: 'Speak Text (TTS)',
            description: 'Speak a message via TTS',
            category: 'tts',
            icon: 'mic',
            fields: [
                { name: 'text', label: 'Message', type: 'textarea', required: true }
            ],
            executor: async (action, context, services) => {
                const text = services.templateEngine.render(action.text, context.data);
                await services.tts.speak({ text });
            }
        });

        this.register('obs:scene', {
            id: 'obs:scene',
            name: 'Switch OBS Scene',
            description: 'Switch to a specific scene',
            category: 'obs',
            icon: 'video',
            fields: [
                { name: 'sceneName', label: 'Scene Name', type: 'text', required: true }
            ],
            executor: async (action, context, services) => {
                const scene = services.templateEngine.render(action.sceneName, context.data);
                await services.obs.setCurrentProgramScene({ sceneName: scene });
            }
        });
        
        this.register('webhook:send', {
            id: 'webhook:send',
            name: 'Send Webhook',
            description: 'Send an HTTP request',
            category: 'integration',
            icon: 'send',
            fields: [
                { name: 'url', label: 'URL', type: 'text', required: true },
                { name: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'] }
            ],
            executor: async (action, context, services) => {
                await this.validateWebhookUrl(action.url, DEFAULT_ALLOWED_WEBHOOK_DOMAINS);
                const data = action.body ? JSON.parse(services.templateEngine.render(action.body, context.data)) : context.data;
                await services.axios({ method: action.method || 'POST', url: action.url, data });
            }
        });
    }
}
