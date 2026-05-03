import 'reflect-metadata';
import { createServer } from 'http';
import app from './app';
import { initializeSocket } from './config/socket.config';
import kafkaConsumerService from './services/kafka.consumer.service';
import logger from './utils/logger';
import { MESSAGES } from './constants/messages';
import { AppDataSource } from './config/database.config';

const PORT = parseInt(process.env.PORT || '3000', 10);

const httpServer = createServer(app);
const io = initializeSocket(httpServer);

async function initializeApp() {
    try {
        await AppDataSource.initialize();
        logger.info('Base de datos conectada');

        httpServer.listen(PORT, async () => {
            logger.info(`${MESSAGES.SERVER.STARTED} ${PORT}`);

            try {
                await kafkaConsumerService.start();
                logger.info(MESSAGES.SERVER.CONSUMER_STARTED);
            } catch (error) {
                logger.error(MESSAGES.SERVER.START_ERROR, error);
            }
        });
    } catch (error) {
        logger.error('Error al inicializar la aplicación', error);
        process.exit(1);
    }
}

initializeApp();

process.on('SIGINT', async () => {
    await kafkaConsumerService.stop();
    await AppDataSource.destroy();
    httpServer.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
    await kafkaConsumerService.stop();
    await AppDataSource.destroy();
    httpServer.close(() => process.exit(0));
});
