import express from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';

import { ILogger, LoggerService } from './modules/LoggerService';
import { ConfigPathManager } from './modules/ConfigPathManager';
import { DatabaseService } from './modules/DatabaseService';
import { ProfileService } from './modules/ProfileService';
import { InitializationService } from './modules/InitializationService';
import { NetworkManager } from './modules/NetworkManager';
import { ErrorHandler } from './modules/ErrorHandler';
import { I18nService } from './modules/I18nService';
import { UpdateService } from './modules/UpdateService';
import { AutoStartService } from './modules/AutoStartService';
import { CloudSyncService } from './modules/CloudSyncService';
import { PresetService } from './modules/PresetService';
import { LeaderboardService } from './modules/LeaderboardService';
import { SubscriptionService } from './modules/SubscriptionService';
import { OBSService } from './modules/OBSService';
import { IFTTTService } from './modules/ifttt/IFTTTService';
import { TTSService } from './modules/TTSService';
import { AlertService } from './modules/AlertService';
import { GoalService } from './modules/GoalService';
import { TikTokConnector } from './modules/tiktok/TikTokConnector';
import { PluginLoader } from './modules/PluginLoader';
import { BackupManager } from './modules/BackupManager';
import { AutoReconnectService } from './modules/AutoReconnectService';
import { TemplateEngine, templateEngine } from './modules/TemplateEngine';
import { VDONinjaService } from './modules/VDONinjaService';
import { SessionExtractorService } from './modules/SessionExtractorService';
import { UserDatabaseService } from './modules/UserDatabaseService';
import { initState } from './modules/InitializationService';

import { I18nRoutes } from './routes/I18nRoutes';
import { UpdateRoutes } from './routes/UpdateRoutes';
import { AutoStartRoutes } from './routes/AutoStartRoutes';
import { CloudSyncRoutes } from './routes/CloudSyncRoutes';
import { PresetRoutes } from './routes/PresetRoutes';
import { ProfileRoutes } from './routes/ProfileRoutes';
import { LeaderboardRoutes } from './routes/LeaderboardRoutes';
import { SubscriptionRoutes } from './routes/SubscriptionRoutes';
import { OBSRoutes } from './routes/OBSRoutes';
import { IFTTTRoutes } from './routes/IFTTTRoutes';
import { TikTokRoutes } from './routes/TikTokRoutes';
import { AlertRoutes } from './routes/AlertRoutes';
import { GoalRoutes } from './routes/GoalRoutes';
import { BackupRoutes } from './routes/BackupRoutes';
import { PluginRoutes } from './routes/PluginRoutes';
import { WikiRoutes } from './routes/WikiRoutes';
import { DebugRoutes } from './routes/DebugRoutes';
import { VDONinjaRoutes } from './routes/VDONinjaRoutes';
import { SessionRoutes } from './routes/SessionRoutes';
import { UserRoutes } from './routes/UserRoutes';

import { VDONinjaController } from './controllers/VDONinjaController';
import { SessionController } from './controllers/SessionController';
import { UserController } from './controllers/UserController';

import { CORSManager } from './modules/CORSManager';
import { RateLimiter } from './modules/RateLimiter';
import { debugLogger } from './modules/DebugLogger';

export class App {
    private readonly app: express.Application;
    private readonly httpServer: HttpServer;
    private readonly io: SocketServer;
    private readonly logger: ILogger;

    // Core Infrastructure
    private configPathManager!: ConfigPathManager;
    private profileService!: ProfileService;
    private db!: DatabaseService;
    private initializationService!: InitializationService;
    private networkManager!: NetworkManager;

    // Services
    private i18nService!: I18nService;
    private updateService!: UpdateService;
    private autoStartService!: AutoStartService;
    private cloudSyncService!: CloudSyncService;
    private presetService!: PresetService;
    private leaderboardService!: LeaderboardService;
    private subscriptionService!: SubscriptionService;
    private obsService!: OBSService;
    private iftttService!: IFTTTService;
    private ttsService!: TTSService;
    private alertService!: AlertService;
    private goalService!: GoalService;
    private tiktok!: TikTokConnector;
    private pluginLoader!: PluginLoader;
    private backupManager!: BackupManager;
    private autoReconnectService!: AutoReconnectService;

    // Modularized Services
    private templateEngine: TemplateEngine = templateEngine;
    private vdoNinjaService!: VDONinjaService;
    private sessionExtractor!: SessionExtractorService;
    private userDatabase!: UserDatabaseService;

    constructor() {
        this.app = express();
        this.httpServer = new HttpServer(this.app);
        this.io = new SocketServer(this.httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        this.logger = LoggerService.getInstance();
    }

    public async initialize(): Promise<void> {
        this.logger.info('🚀 Initializing LTTH Desktop App...');

        // 1. Core Infrastructure
        this.configPathManager = new ConfigPathManager();
        this.profileService = new ProfileService(this.configPathManager);
        
        let activeProfile = this.profileService.getActiveProfile();
        if (!activeProfile) {
            activeProfile = 'default';
            this.profileService.createProfile(activeProfile);
            this.profileService.setActiveProfile(activeProfile);
        }

        const dbPath = this.profileService.getProfilePath(activeProfile);
        this.db = DatabaseService.getInstance();
        this.db.connect(dbPath, activeProfile);
        
        this.initializationService = initState;
        this.initializationService.setDatabaseReady();

        this.networkManager = new NetworkManager(this.db, this.logger);
        await this.networkManager.init();

        // 2. Services
        this.i18nService = new I18nService('en');
        // i18n initialization is handled in constructor

        this.updateService = new UpdateService(this.logger);
        this.autoStartService = new AutoStartService(this.logger);
        this.cloudSyncService = new CloudSyncService(this.db, this.logger, this.configPathManager);
        await this.cloudSyncService.initialize();
        this.presetService = new PresetService(this.db, this.logger);
        
        // Services requiring IO
        this.leaderboardService = new LeaderboardService(this.db, this.io, 'default', this.logger);
        this.subscriptionService = new SubscriptionService(this.db, this.io, this.logger);
        this.obsService = new OBSService(this.db, this.io, this.logger);
        this.ttsService = new TTSService(this.logger);
        
        const iftttExtraServices = {
            io: this.io,
            db: this.db,
            obs: this.obsService,
            tts: this.ttsService,
            logger: this.logger
        };
        this.iftttService = new IFTTTService(this.db, this.logger, iftttExtraServices);
        this.iftttService.setupTimerTriggers();

        this.alertService = new AlertService(this.db, this.io, this.logger);
        this.goalService = new GoalService(this.db, this.io, this.logger);
        this.tiktok = new TikTokConnector(this.io, this.db, this.logger);

        this.vdoNinjaService = new VDONinjaService(this.db, this.io, this.logger);
        this.sessionExtractor = new SessionExtractorService(this.db, this.configPathManager);
        this.userDatabase = new UserDatabaseService();

        this.autoReconnectService = new AutoReconnectService(this.db, this.logger, this.tiktok, this.obsService);

        // 3. Backup and Migration
        this.backupManager = new BackupManager(this.db, this.configPathManager, null as any, this.logger);

        // 4. Plugin System
        const pluginsDir = path.join(__dirname, 'plugins');
        this.pluginLoader = new PluginLoader(pluginsDir, this.app, this.io, this.db, this.logger, this.configPathManager, activeProfile);
        this.pluginLoader.setTikTokModule(this.tiktok);
        this.pluginLoader.setIFTTTService(this.iftttService);
        this.pluginLoader.setBackupManager(this.backupManager);
        this.alertService.setPluginLoader(this.pluginLoader);

        // Re-inject pluginLoader into backupManager
        (this.backupManager as any).pluginLoader = this.pluginLoader;

        await this.pluginLoader.loadAllPlugins();
        this.pluginLoader.registerPluginsIFTTT(this.iftttService);
        initState.setPluginsLoaded(this.pluginLoader.getPlugins().length);
        initState.setAllPluginsInitialized();
        initState.setPluginInjectionsComplete();
        initState.setSocketReady();

        // 5. Express Middleware
        this.setupMiddleware();

        // 4. Routes
        this.setupRoutes();

        // 5. Error Handling
        this.setupErrorHandling();

        this.logger.info('✅ Application initialization complete');
    }

    private setupMiddleware(): void {
        this.app.use(helmet({
            contentSecurityPolicy: false // Handled by CORSManager
        }));
        this.app.use(compression());
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

        // Custom CORS/CSP Logic
        const corsManager = new CORSManager(this.logger);
        this.app.use(corsManager.handleCORS);
        this.app.use(corsManager.handleCSP);

        // Rate Limiting
        const rateLimiter = new RateLimiter(this.logger);
        this.app.use('/api/', rateLimiter.apiLimiter);
        this.app.use('/api/auth', rateLimiter.authLimiter);

        // Static Files (Legacy & Public)
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use('/plugins', express.static(path.join(__dirname, 'plugins'), {
            maxAge: '1h',
            etag: true
        }));
        this.app.use('/tts', express.static(path.join(__dirname, 'tts')));
        this.app.use('/sounds', express.static(path.join(__dirname, 'public', 'sounds')));
    }

    private setupRoutes(): void {
        const i18nRoutes = new I18nRoutes(this.i18nService, this.logger);
        const updateRoutes = new UpdateRoutes(this.updateService, this.logger);
        const autoStartRoutes = new AutoStartRoutes(this.autoStartService, this.logger);
        const cloudSyncRoutes = new CloudSyncRoutes(this.cloudSyncService, this.logger);
        const presetRoutes = new PresetRoutes(this.presetService, this.logger);
        const profileRoutes = new ProfileRoutes(this.profileService, this.logger);
        const leaderboardRoutes = new LeaderboardRoutes(this.leaderboardService, this.logger);
        const subscriptionRoutes = new SubscriptionRoutes(this.subscriptionService, this.logger);
        const obsRoutes = new OBSRoutes(this.obsService, this.logger);
        const iftttRoutes = new IFTTTRoutes(this.iftttService, this.db, this.logger);
        const tiktokRoutes = new TikTokRoutes(this.tiktok, this.logger);
        const alertRoutes = new AlertRoutes(this.alertService, this.logger);
        const goalRoutes = new GoalRoutes(this.goalService, this.logger);
        const backupRoutes = new BackupRoutes(this.backupManager, this.logger);
        const pluginRoutes = new PluginRoutes(this.pluginLoader, this.io, this.logger);
        const wikiRoutes = new WikiRoutes(this.logger);
        const debugRoutes = new DebugRoutes(debugLogger, this.logger);
        
        const vdoNinjaController = new VDONinjaController(this.vdoNinjaService, this.logger);
        const vdoNinjaRoutes = new VDONinjaRoutes(vdoNinjaController, this.logger);

        const sessionController = new SessionController(this.sessionExtractor, this.logger);
        const sessionRoutes = new SessionRoutes(sessionController, this.logger);

        const userController = new UserController(this.userDatabase, this.logger);
        const userRoutes = new UserRoutes(userController, this.logger);

        // API Registration
        this.app.use('/api/i18n', i18nRoutes.getRouter());
        this.app.use('/api/update', updateRoutes.getRouter());
        this.app.use('/api/autostart', autoStartRoutes.getRouter());
        this.app.use('/api/sync', cloudSyncRoutes.getRouter());
        this.app.use('/api/presets', presetRoutes.getRouter());
        this.app.use('/api/profiles', profileRoutes.getRouter());
        this.app.use('/api/leaderboard', leaderboardRoutes.getRouter());
        this.app.use('/api/subscriptions', subscriptionRoutes.getRouter());
        this.app.use('/api/obs', obsRoutes.getRouter());
        this.app.use('/api/ifttt', iftttRoutes.getRouter());
        this.app.use('/api/flows', iftttRoutes.getRouter()); // Legacy compatibility
        this.app.use('/api/tiktok', tiktokRoutes.getRouter());
        this.app.use('/api/alerts', alertRoutes.getRouter());
        this.app.use('/api/goals', goalRoutes.getRouter());
        this.app.use('/api/backup', backupRoutes.getRouter());
        this.app.use('/api/plugins', pluginRoutes.getRouter());
        this.app.use('/api/wiki', wikiRoutes.getRouter());
        this.app.use('/api/debug', debugRoutes.getRouter());
        this.app.use('/api/vdoninja', vdoNinjaRoutes.getRouter());
        this.app.use('/api/session', sessionRoutes.getRouter());
        this.app.use('/api/users', userRoutes.getRouter());

        // Legacy Compat Routes
        this.app.get('/api/init-state', (req, res) => {
            res.json(initState.getState());
        });
        
        this.app.get('/api/network/config', (req, res) => {
            res.json({ bindMode: 'local', port: 3000, externalUrl: '', tunnelEnabled: false });
        });

        this.app.get('/api/settings', (req, res) => {
            res.json(this.db.getAllSettings());
        });

        this.app.post('/api/settings', (req, res) => {
            try {
                for (const [key, value] of Object.entries(req.body)) {
                    this.db.setSetting(key, value);
                }
                res.json({ success: true });
            } catch (error: any) {
                this.logger.error('Failed to update settings:', error);
                res.json({ success: false, error: error.message });
            }
        });

        this.app.get('/api/config-path', (req, res) => {
            res.json({ path: this.configPathManager.getConfigDir() });
        });

        this.app.get('/api/connection-health', (req, res) => {
            res.json({ status: 'ok', connected: true });
        });

        // Root/Status redirect
        this.app.get('/', (req, res) => res.redirect('/dashboard.html'));
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                pid: process.pid,
                uptime: process.uptime(),
                version: '1.3.3'
            });
        });

        this.app.get('/CHANGELOG.md', (req, res) => {
            res.sendFile(path.join(__dirname, '../../CHANGELOG.md'));
        });
    }

    private setupErrorHandling(): void {
        const errorHandler = new ErrorHandler(this.logger);
        this.app.use(errorHandler.handleErrors);
    }

    public async start(port: number): Promise<void> {
        return new Promise((resolve) => {
            this.httpServer.listen(port, '0.0.0.0', async () => {
                this.logger.info(`🌐 Server running at http://localhost:${port}`);
                initState.setServerStarted();

                // 6. Post-Startup Orchestration
                await this.autoReconnectService.reconnectAll();
                
                if (this.networkManager.tunnelEnabled) {
                    this.networkManager.startTunnel(port).catch(err => {
                        this.logger.warn(`⚠️ Tunnel auto-start failed: ${err.message}`);
                    });
                }

                this.updateService.startAutoCheck(24);

                resolve();
            });
        });
    }

    public async shutdown(): Promise<void> {
        this.logger.info('🛑 Shutting down LTTH App...');

        const forceExitTimer = setTimeout(() => {
            this.logger.warn('⚠️ Graceful shutdown timed out, forcing exit...');
            process.exit(0);
        }, 5000);
        forceExitTimer.unref();

        // 1. Service Cleanup
        if (this.tiktok.isActive()) this.tiktok.disconnect();
        if (this.obsService.isConnected()) await this.obsService.disconnect();
        await this.cloudSyncService.disable(); // Stops watchers
        this.updateService.stopAutoCheck();
        this.networkManager.shutdown();

        // 2. IO Cleanup
        this.io.disconnectSockets(true);

        // 3. Database Cleanup
        this.db.close();

        // 4. Server Cleanup
        return new Promise((resolve) => {
            this.httpServer.close(() => {
                clearTimeout(forceExitTimer);
                this.logger.info('✅ Shutdown complete');
                resolve();
            });
        });
    }

    public getIO(): SocketServer {
        return this.io;
    }
}
