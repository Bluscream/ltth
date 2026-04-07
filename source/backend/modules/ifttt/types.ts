export interface IFTTTAction {
    id: string;
    type: string;
    params: Record<string, any>;
    enabled: boolean;
}

export interface IFTTTCondition {
    id: string;
    type: string;
    operator: string;
    value: any;
    field: string;
}

export interface IFTTTTrigger {
    id: string;
    type: string;
    config: Record<string, any>;
}

export interface IFTTTFlow {
    id: string;
    name: string;
    enabled: boolean;
    trigger: IFTTTTrigger;
    conditions: IFTTTCondition[];
    actions: IFTTTAction[];
    createdAt: number;
    lastExecuted?: number;
}

export interface ExecutionContext {
    eventType: string;
    eventData: any;
    variables: Record<string, any>;
    timestamp: number;
}
