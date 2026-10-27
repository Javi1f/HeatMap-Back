import './loadEnv';
import 'reflect-metadata';
import { createServer, Server as HttpServer } from 'http';
import { container } from 'tsyringe';
import { createApp } from './app';
import { AppConfig } from './config/app.config';
import { KafkaConfig } from './config/kafka.config';
import { DatabaseConfig } from './config/database.config';
import { LoggerService } from './common/logger/logger.service';
import { CotizacionRepository } from './persistencia/repositorios/cotizacion.repository';
import {
    CotizacionRepositoryArchivo,
    rutaSolicitudesArchivo,
} from './persistencia/repositorios/cotizacion.repository-archivo';
import { SocketEmitterService } from './modules/tiempo-real/socket-emitter.service';
import { KafkaConsumerService } from './modules/ingesta/kafka-consumer.service';
import { OccupancyAggregatorService } from './modules/procesamiento/occupancy-aggregator.service';
import { MESSAGES } from './constants/messages';

/**
 * Cierre limpio de los recursos abiertos en `bootstrap`.
 *
 * No llama a `process.exit()`: en su lugar fija `process.exitCode` y deja
 * que el loop drene de forma natural una vez cerrados los handles
 * (Kafka consumer, Socket.IO, HTTP server, DataSource). Es el patrón
 * recomendado por Node — un `process.exit()` abrupto puede matar callbacks
 * en vuelo (por ejemplo, escrituras a logs externos).
 */
const shutdownAll = async (
    httpServer: HttpServer,
    db: DatabaseConfig,
    consumer: KafkaConsumerService,
    aggregator: OccupancyAggregatorService,
    emitter: SocketEmitterService,
    logger: LoggerService,
    signal: string,
): Promise<void> => {
    logger.info(`Señal ${signal} recibida, cerrando...`);
    try {
        aggregator.stop();
        await consumer.stop();
        await emitter.close();
        await new Promise<void>((resolve, reject) => {
            httpServer.close((err) => (err ? reject(err) : resolve()));
        });
        await db.destroy();
        logger.info('Shutdown completo');
        process.exitCode = 0;
    } catch (err) {
        logger.error('Error durante shutdown', err);
        process.exitCode = 1;
    }
};

/**
 * Registra handlers para shutdown graceful en SIGINT y SIGTERM.
 * Cierra en orden inverso al arranque: consumer → socket → http → db.
 */
const registerShutdownHooks = (
    httpServer: HttpServer,
    db: DatabaseConfig,
    consumer: KafkaConsumerService,
    aggregator: OccupancyAggregatorService,
    emitter: SocketEmitterService,
    logger: LoggerService,
): void => {
    /**
     * Handler común para SIGINT y SIGTERM.
     *
     * Lanza el cierre asíncrono y captura cualquier excepción no manejada
     * para garantizar que `process.exitCode` quede definido y el proceso
     * termine con un código coherente.
     *
     * @param signal - Señal POSIX recibida (`SIGINT` o `SIGTERM`).
     */
    const onSignal = (signal: NodeJS.Signals): void => {
        shutdownAll(httpServer, db, consumer, aggregator, emitter, logger, signal).catch((err) => {
            logger.error('Fallo no manejado en shutdown', err);
            process.exitCode = 1;
        });
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
};

/**
 * Punto de entrada de la aplicación.
 *
 * Responsabilidades:
 *  1. Cargar variables de entorno (vía `./loadEnv`).
 *  2. Registrar `reflect-metadata` (requerido por TypeORM y tsyringe).
 *  3. Inicializar la base de datos.
 *  4. Crear el servidor HTTP a partir de `createApp()`.
 *  5. Inicializar el servidor Socket.IO.
 *  6. Arrancar el consumidor de Kafka, salvo que la ingesta la haga otra
 *     instancia (`KAFKA_CONSUMER_ENABLED=false`).
 *  7. Registrar shutdown limpio en SIGINT/SIGTERM.
 *
 * Si cualquier paso crítico falla, loguea el error y marca `process.exitCode = 1`.
 */
const bootstrap = async (): Promise<void> => {
    const logger = container.resolve(LoggerService);

    // Las cotizaciones son el único módulo que no toca la base: sus
    // solicitudes viven en un JSON local y el resto del sistema sigue
    // leyendo y escribiendo en MySQL como siempre. Se decide aquí, antes de
    // que el contenedor resuelva el repositorio por primera vez (los routers
    // se arman dentro de createApp).
    //
    // Fábrica y no registerSingleton: el repositorio del archivo recibe su
    // ruta por constructor (con valor por defecto) y el inyector intentaría
    // resolverla como si fuera una dependencia. Como el servicio de
    // cotización es singleton, hay una sola instancia igual. El cast es solo
    // de compilación: la clase de TypeORM lleva campos privados y TypeScript
    // vuelve nominal a una clase así; las dos cumplen el mismo contrato.
    container.register(CotizacionRepository, {
        useFactory: (): CotizacionRepository =>
            new CotizacionRepositoryArchivo() as unknown as CotizacionRepository,
    });
    logger.info(`Cotizaciones en archivo local: ${rutaSolicitudesArchivo()}`);

    const cfg = container.resolve(AppConfig);
    const db = container.resolve(DatabaseConfig);
    const emitter = container.resolve(SocketEmitterService);
    const consumer = container.resolve(KafkaConsumerService);
    const aggregator = container.resolve(OccupancyAggregatorService);

    await db.initialize();
    logger.info('Base de datos conectada con TLS');
    if (!db.verificaCertificado) {
        logger.warn('DB_SSL_CA no configurada: la conexión a MySQL va cifrada pero sin verificar el certificado del servidor');
    }

    const app = createApp();
    const httpServer: HttpServer = createServer(app);
    emitter.initialize(httpServer);

    await new Promise<void>((resolve) => {
        httpServer.listen(cfg.port, resolve);
    });
    logger.info(`${MESSAGES.SERVER.STARTED} ${cfg.port}`);

    if (!container.resolve(KafkaConfig).consumerEnabled) {
        logger.warn(MESSAGES.SERVER.CONSUMER_DISABLED);
    } else {
        try {
            await consumer.start();
            logger.info(MESSAGES.SERVER.CONSUMER_STARTED);
        } catch (err) {
            logger.error(MESSAGES.SERVER.START_ERROR, err);
        }
    }

    // La consolidación de ocupación es independiente del consumer: aunque
    // Kafka no esté disponible, sigue habiendo detecciones previas que agregar.
    aggregator.start();

    registerShutdownHooks(httpServer, db, consumer, aggregator, emitter, logger);
};

bootstrap().catch((err) => {
    // Sin logger disponible todavía: la consola es el único canal.
    console.error('Error fatal al inicializar la aplicación', err); // skipcq: JS-0002
    process.exitCode = 1;
});
