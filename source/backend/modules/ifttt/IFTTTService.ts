import { ILogger } from '../LoggerService';
import { DatabaseService } from '../DatabaseService';
import { TriggerRegistry } from './TriggerRegistry';
import { ConditionRegistry } from './ConditionRegistry';
import { ActionRegistry } from './ActionRegistry';
import { VariableStore } from './VariableStore';
import { IFTTTFlow } from './types';

/**
 * IFTTTService - Advanced automation engine for processing event-driven flows
 */
export class IFTTTService {
    private db: DatabaseService;
    private logger: ILogger;
    private services: any;
    
    public triggers: TriggerRegistry;
    public conditions: ConditionRegistry;
    public actions: ActionRegistry;
    public variables: VariableStore;

    private executionStack: string[] = [];
    private maxExecutionDepth = 10;
    private schedulers: Map<string, NodeJS.Timeout> = new Map();

    constructor(db: DatabaseService, logger: ILogger = console, services: any = {}) {
        this.db = db;
        this.logger = logger;
        this.services = services;

        this.triggers = new TriggerRegistry(logger);
        this.conditions = new ConditionRegistry(logger);
        this.actions = new ActionRegistry(logger);
        this.variables = new VariableStore(logger);

        this.logger.info('✅ IFTTT Service initialized');
    }

    public async processEvent(eventType: string, eventData: any = {}): Promise<void> {
        const flowsEnabled = this.db.getSetting('flows_enabled');
        if (flowsEnabled === 'false') return;

        this.variables.addEvent({ type: eventType, data: eventData });

        const flows = this.getEnabledFlows();
        const matchingFlows = flows.filter(f => this.mapTriggerType(f.trigger.type) === eventType);

        if (matchingFlows.length === 0) return;

        this.logger.info(`📡 Processing ${eventType} event, ${matchingFlows.length} matching flow(s)`);

        await Promise.allSettled(matchingFlows.map(flow => this.executeFlow(flow, eventData)));
    }

    public async executeFlow(flow: IFTTTFlow, eventData: any = {}): Promise<void> {
        if (this.executionStack.length >= this.maxExecutionDepth) {
            this.logger.warn(`⚠️ Max execution depth reached for flow: ${flow.name}`);
            return;
        }

        this.executionStack.push(flow.id);
        const startTime = Date.now();

        try {
            const context = this.variables.createContext(eventData, { flowId: flow.id, flowName: flow.name });
            
            // Check conditions
            const allMet = flow.conditions.every(c => this.conditions.evaluate(c, context));
            if (!allMet) {
                this.executionStack.pop();
                return;
            }

            // Execute actions
            for (const action of flow.actions) {
                if (!action.enabled) continue;
                await this.actions.execute(action, context, { ...this.services, variables: this.variables });
            }

            this.logger.info(`✅ Flow "${flow.name}" completed in ${Date.now() - startTime}ms`);
        } catch (error: any) {
            this.logger.error(`❌ Flow "${flow.name}" execution error:`, error);
        } finally {
            this.executionStack.pop();
        }
    }

    private getEnabledFlows(): IFTTTFlow[] {
        // This is a placeholder for actual DB fetch logic
        // In the real app, flows are stored as JSON in the 'flows' table
        const rows = this.db.all('SELECT * FROM flows WHERE enabled = 1');
        return rows.map(r => ({
            id: r.id.toString(),
            name: r.name,
            enabled: true,
            trigger: JSON.parse(r.trigger_type), // Simplified mapping for now
            conditions: JSON.parse(r.trigger_condition || '[]'),
            actions: JSON.parse(r.actions || '[]'),
            createdAt: new Date(r.created_at).getTime()
        }));
    }

    private mapTriggerType(type: string): string {
        const mapping: Record<string, string> = {
            'gift': 'tiktok:gift',
            'chat': 'tiktok:chat',
            'follow': 'tiktok:follow'
        };
        return mapping[type] || type;
    }

    public setupTimerTriggers(): void {
        const flows = this.getEnabledFlows();
        flows.forEach(flow => {
            if (flow.trigger.type === 'timer:interval') {
                const seconds = flow.trigger.config.intervalSeconds || 60;
                const id = setInterval(() => this.executeFlow(flow, { type: 'timer:interval' }), seconds * 1000);
                this.schedulers.set(flow.id, id);
            }
        });
    }

    public destroy(): void {
        this.schedulers.forEach(s => clearInterval(s));
        this.schedulers.clear();
    }
}
