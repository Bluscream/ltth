import dotenv from 'dotenv';
import path from 'path';
import { App } from './App';
import { LoggerService } from './modules/LoggerService';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const logger = LoggerService.getInstance();
const PORT = parseInt(process.env.PORT || '3000', 10);

async function bootstrap() {
    try {
        const app = new App();
        
        // Handle termination signals
        process.on('SIGINT', async () => {
            await app.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            await app.shutdown();
            process.exit(0);
        });

        // Initialize and start
        await app.initialize();
        await app.start(PORT);

    } catch (error) {
        logger.error('💥 Failed to start LTTH Server:', error);
        process.exit(1);
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    logger.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('❌ Unhandled Rejection at promise:', reason);
});

bootstrap();
