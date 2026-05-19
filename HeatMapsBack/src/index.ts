import './loadEnv';
import 'reflect-metadata';
import { createServer, Server as HttpServer } from 'http';
import { container } from 'tsyringe';
import { createApp } from './app';
import { AppConfig } from './config/app.config';
import { DatabaseConfig } from './config/database.config';
import { LoggerService } from './common/logger/logger.service';
import { SocketEmitterService } from './modules/sensor/services/socket-emitter.service';
import { KafkaConsumerService } from './modules/sensor/services/kafka-consumer.service';
import { MESSAGES } from './constants/messages';

/**
 * Punto de entrada de la aplicación.
 *
 * Responsabilidades:
 *  1. Cargar variables de entorno (vía `./loadEnv`).
 *  2. Registrar `reflect-metadata` (requerido por TypeORM y tsyringe).
 *  3. Inicializar la base de datos.
 *  4. Crear el servidor HTTP a partir de `createApp()`.
 *  5. Inicializar el servidor Socket.IO.
 *  6. Arrancar el consumidor de Kafka.
 *  7. Registrar shutdown limpio en SIGINT/SIGTERM.
 *
 * Si cualquier paso crítico falla, loguea el error y termina con código 1.
 */
async function bootstrap(): Promise<void> {
    const logger = container.resolve(LoggerService);
    const cfg = container.resolve(AppConfig);
    const db = container.resolve(DatabaseConfig);
    const emitter = container.resolve(SocketEmitterService);
    const consumer = container.resolve(KafkaConsumerService);

    await db.initialize();
    logger.info('Base de datos conectada');

    const app = createApp();
    const httpServer: HttpServer = createServer(app);
    emitter.initialize(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(cfg.port, resolve));
    logger.info(`${MESSAGES.SERVER.STARTED} ${cfg.port}`);

    try {
        await consumer.start();
        logger.info(MESSAGES.SERVER.CONSUMER_STARTED);
    } catch (err) {
        logger.error(MESSAGES.SERVER.START_ERROR, err);
    }

    registerShutdownHooks(httpServer, db, consumer, emitter, logger);
}

/**
 * Registra handlers para shutdown graceful en SIGINT y SIGTERM.
 * Cierra en orden inverso al arranque: consumer → socket → http → db.
 */
function registerShutdownHooks(
    httpServer: HttpServer,
    db: DatabaseConfig,
    consumer: KafkaConsumerService,
    emitter: SocketEmitterService,
    logger: LoggerService,
): void {
    const shutdown = async (signal: string): Promise<void> => {
        logger.info(`Señal ${signal} recibida, cerrando...`);
        try {
            await consumer.stop();
            await emitter.close();
            await new Promise<void>((resolve, reject) =>
                httpServer.close((err) => (err ? reject(err) : resolve())),
            );
            await db.destroy();
            logger.info('Shutdown completo');
            process.exit(0);
        } catch (err) {
            logger.error('Error durante shutdown', err);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
    // Logger puede no estar inicializado aún; usamos console como último recurso.
    // eslint-disable-next-line no-console
    console.error('Error fatal al inicializar la aplicación', err);
    process.exit(1);
});
