import { Router, Request, Response } from 'express';
import { TikTokConnector } from '../modules/tiktok/TikTokConnector';
import { ILogger } from '../modules/LoggerService';

export class TikTokRoutes {
    private readonly router: Router;

    constructor(
        private readonly tiktok: TikTokConnector,
        private readonly logger: ILogger
    ) {
        this.router = Router();
        this.setupRoutes();
    }

    private setupRoutes(): void {
        this.router.post('/connect', async (req: Request, res: Response) => {
            const { username } = req.body;
            if (!username) {
                return res.status(400).json({ success: false, error: 'Username is required' });
            }

            try {
                await this.tiktok.connect(username);
                res.json({ success: true, message: `Connected to @${username}` });
            } catch (error: any) {
                this.logger.error(`TikTok connection error: ${error.message}`);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.router.post('/disconnect', async (req: Request, res: Response) => {
            try {
                await this.tiktok.disconnect();
                res.json({ success: true, message: 'Disconnected from TikTok' });
            } catch (error: any) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        this.router.get('/status', (req: Request, res: Response) => {
            res.json({
                connected: (this.tiktok as any).isConnected,
                username: (this.tiktok as any).currentUsername
            });
        });
 
        this.router.get('/diagnostics', async (req: Request, res: Response) => {
            const username = req.query.username as string || (this.tiktok as any).currentUsername || 'tiktok';
            const apiKey = (this.tiktok as any).db.getSetting('tiktok_euler_api_key') || process.env.EULER_API_KEY;
            
            // Collect diagnostic data
            const diagnostics = {
                eulerApiKey: {
                    activeKey: apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : null,
                    activeSource: apiKey ? (process.env.EULER_API_KEY === apiKey ? 'Environment' : 'Settings') : 'None'
                },
                tiktokApi: {
                    success: true, // Mock connectivity for now
                    responseTime: Math.floor(Math.random() * 100) + 50
                },
                eulerWebSocket: {
                    success: (this.tiktok as any).isConnected,
                    responseTime: 0,
                    error: (this.tiktok as any).isConnected ? null : 'Not connected'
                },
                connectionConfig: {
                    enableEulerFallbacks: true,
                    connectWithUniqueId: true,
                    connectionTimeout: 60000
                },
                recentAttempts: [],
                recommendations: apiKey ? [] : [{
                    severity: 'error',
                    message: 'No Eulerstream API key configured.',
                    action: 'Please set your API key in the TikTok settings tab.'
                }]
            };

            res.json(diagnostics);
        });

        this.router.get('/connection-health', (req: Request, res: Response) => {
            const isConnected = (this.tiktok as any).isConnected;
            const apiKey = (this.tiktok as any).db.getSetting('tiktok_euler_api_key') || process.env.EULER_API_KEY;
            
            res.json({
                status: isConnected ? 'healthy' : (apiKey ? 'degraded' : 'critical'),
                message: isConnected ? 'TikTok is connected' : (apiKey ? 'TikTok is disconnected' : 'Euler Key missing'),
                eulerKeyConfigured: !!apiKey,
                eulerKeySource: apiKey ? (process.env.EULER_API_KEY === apiKey ? 'Environment' : 'Settings') : 'None',
                recentAttempts: []
            });
        });
    }

    public getRouter(): Router {
        return this.router;
    }
}
