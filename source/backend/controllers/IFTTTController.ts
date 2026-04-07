import { Request, Response } from 'express';
import { IFTTTService } from '../modules/ifttt/IFTTTService';
import { DatabaseService } from '../modules/DatabaseService';
import { ILogger } from '../modules/LoggerService';

export class IFTTTController {
    private iftttService: IFTTTService;
    private db: DatabaseService;
    private logger: ILogger;

    constructor(iftttService: IFTTTService, db: DatabaseService, logger: ILogger) {
        this.iftttService = iftttService;
        this.db = db;
        this.logger = logger;
    }

    public getAllFlows = (req: Request, res: Response) => {
        try {
            const flows = this.db.all('SELECT * FROM flows');
            const enriched = flows.map(flow => ({
                ...flow,
                cooldown: parseInt(this.db.getSetting(`flow_cooldown_${flow.id}`)) || 0
            }));
            res.json(enriched);
        } catch (error: any) {
            this.logger.error('Error getting flows:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public getFlow = (req: Request, res: Response) => {
        try {
            const flow = this.db.get('SELECT * FROM flows WHERE id = ?', [req.params.id]);
            if (!flow) {
                return res.status(404).json({ success: false, error: 'Flow not found' });
            }
            res.json({
                ...flow,
                cooldown: parseInt(this.db.getSetting(`flow_cooldown_${flow.id}`)) || 0
            });
        } catch (error: any) {
            this.logger.error('Error getting flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public createFlow = (req: Request, res: Response) => {
        const flow = req.body;
        if (!flow.name || !flow.trigger_type || !flow.actions) {
            return res.status(400).json({ success: false, error: 'Name, trigger_type and actions are required' });
        }

        try {
            // Simplified create logic for placeholder
            const result = this.db.run('INSERT INTO flows (name, trigger_type, actions, enabled) VALUES (?, ?, ?, ?)', 
                [flow.name, JSON.stringify(flow.trigger_type), JSON.stringify(flow.actions), 1]);
            const id = result.lastID;
            
            if (flow.cooldown !== undefined) {
                this.db.setSetting(`flow_cooldown_${id}`, String(parseInt(flow.cooldown) || 0));
            }
            
            this.logger.info(`➕ Created flow: ${flow.name}`);
            res.json({ success: true, id });
        } catch (error: any) {
            this.logger.error('Error creating flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public updateFlow = (req: Request, res: Response) => {
        const flow = req.body;
        try {
            this.db.run('UPDATE flows SET name = ?, trigger_type = ?, actions = ? WHERE id = ?', 
                [flow.name, JSON.stringify(flow.trigger_type), JSON.stringify(flow.actions), req.params.id]);
            
            if (flow.cooldown !== undefined) {
                this.db.setSetting(`flow_cooldown_${req.params.id}`, String(parseInt(flow.cooldown) || 0));
            }
            
            this.logger.info(`✏️ Updated flow: ${req.params.id}`);
            res.json({ success: true });
        } catch (error: any) {
            this.logger.error('Error updating flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public deleteFlow = (req: Request, res: Response) => {
        try {
            this.db.run('DELETE FROM flows WHERE id = ?', [req.params.id]);
            this.db.deleteSetting(`flow_cooldown_${req.params.id}`);
            this.logger.info(`🗑️ Deleted flow: ${req.params.id}`);
            res.json({ success: true });
        } catch (error: any) {
            this.logger.error('Error deleting flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public toggleFlow = (req: Request, res: Response) => {
        const { enabled } = req.body;
        try {
            this.db.run('UPDATE flows SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
            this.logger.info(`🔄 Toggled flow ${req.params.id}: ${enabled}`);
            res.json({ success: true });
        } catch (error: any) {
            this.logger.error('Error toggling flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };

    public testFlow = async (req: Request, res: Response) => {
        try {
            // executeFlowById would need to be implemented or adapted
            const flow = this.db.get('SELECT * FROM flows WHERE id = ?', [req.params.id]);
            if (!flow) return res.status(404).json({ success: false, error: 'Flow not found' });
            
            // Map DB row to IFTTTFlow interface
            const flowObj = {
                id: flow.id.toString(),
                name: flow.name,
                enabled: flow.enabled === 1,
                trigger: JSON.parse(flow.trigger_type),
                conditions: JSON.parse(flow.trigger_condition || '[]'),
                actions: JSON.parse(flow.actions || '[]'),
                createdAt: Date.now()
            };

            await this.iftttService.executeFlow(flowObj, req.body);
            this.logger.info(`🧪 Tested flow: ${req.params.id}`);
            res.json({ success: true });
        } catch (error: any) {
            this.logger.error('Error testing flow:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    };
}
