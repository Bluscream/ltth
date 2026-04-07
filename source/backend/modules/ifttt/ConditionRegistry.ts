import { ILogger } from '../LoggerService';

export type ValueType = 'text' | 'number' | 'boolean' | 'regex' | 'list' | 'time' | 'dynamic';

export interface ConditionConfig {
    id: string;
    name: string;
    description: string;
    category: string;
    icon: string;
    valueType: ValueType;
    operators: string[];
    evaluator?: (condition: any, context: any) => boolean;
    metadata: Record<string, any>;
}

export interface OperatorConfig {
    id: string;
    name: string;
    symbol: string;
    valueTypes: ValueType[];
    evaluator: (value: any, compareValue: any, context?: any) => boolean;
}

/**
 * ConditionRegistry - Central registry for all available conditions
 */
export class ConditionRegistry {
    private logger: ILogger;
    private conditions: Map<string, ConditionConfig> = new Map();
    private operators: Map<string, OperatorConfig> = new Map();

    constructor(logger: ILogger = console) {
        this.logger = logger;
        this.registerCoreOperators();
        this.registerCoreConditions();
    }

    public register(id: string, config: Partial<ConditionConfig>): void {
        const condition: ConditionConfig = {
            id,
            name: config.name || id,
            description: config.description || '',
            category: config.category || 'custom',
            icon: config.icon || 'filter',
            valueType: config.valueType || 'text',
            operators: config.operators || ['equals'],
            evaluator: config.evaluator,
            metadata: config.metadata || {}
        };
        this.conditions.set(id, condition);
    }

    public registerOperator(id: string, config: OperatorConfig): void {
        this.operators.set(id, config);
    }

    public get(id: string): ConditionConfig | undefined {
        return this.conditions.get(id);
    }

    public getOperator(id: string): OperatorConfig | undefined {
        return this.operators.get(id);
    }

    public getAll(): ConditionConfig[] {
        return Array.from(this.conditions.values());
    }

    public evaluate(condition: any, context: any): boolean {
        const def = this.conditions.get(condition.type);
        if (!def) return false;

        if (def.evaluator) {
            return def.evaluator(condition, context);
        }

        const operator = this.operators.get(condition.operator);
        if (!operator) return false;

        return operator.evaluator(condition.value, condition.compareValue, context);
    }

    private registerCoreOperators(): void {
        this.registerOperator('equals', {
            id: 'equals',
            name: 'Equals',
            symbol: '==',
            valueTypes: ['text', 'number', 'boolean'],
            evaluator: (v, cv) => v == cv
        });

        this.registerOperator('greater_than', {
            id: 'greater_than',
            name: 'Greater Than',
            symbol: '>',
            valueTypes: ['number'],
            evaluator: (v, cv) => Number(v) > Number(cv)
        });

        this.registerOperator('contains', {
            id: 'contains',
            name: 'Contains',
            symbol: 'contains',
            valueTypes: ['text'],
            evaluator: (v, cv) => String(v).toLowerCase().includes(String(cv).toLowerCase())
        });
    }

    private registerCoreConditions(): void {
        this.register('field_value', {
            name: 'Field Value',
            category: 'basic',
            valueType: 'dynamic',
            operators: ['equals', 'greater_than', 'contains']
        });

        this.register('cooldown', {
            name: 'Cooldown',
            category: 'timing',
            valueType: 'number',
            evaluator: (cond, ctx) => {
                const key = cond.key || 'default';
                const seconds = cond.value || 60;
                const last = ctx.cooldowns?.get(key);
                if (!last) return true;
                return (Date.now() - last) / 1000 >= seconds;
            }
        });

        this.register('random_chance', {
            name: 'Random Chance',
            category: 'logic',
            valueType: 'number',
            evaluator: (cond) => Math.random() * 100 < (cond.value || 50)
        });
    }
}
