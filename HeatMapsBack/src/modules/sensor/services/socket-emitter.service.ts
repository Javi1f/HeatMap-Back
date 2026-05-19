import { injectable } from 'tsyringe';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { SocketConfig } from '../../../config/socket.config';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData } from '../../../types/sensor.types';
import { MESSAGES } from '../../../constants/messages';

/**
 * Servicio responsable de difundir eventos en tiempo real a los clientes
 * conectados por Socket.IO.
 *
 * Reemplaza el anti-patrón de tener variables globales (`io`) y funciones
 * sueltas (`emitSensorData`) en `socket.config.ts`. Ahora el estado
 * vive dentro de una instancia gestionada por el contenedor DI.
 */
@injectable()
export class SocketEmitterService {
    private io: SocketIOServer | null = null;

    constructor(
        private readonly cfg: SocketConfig,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Inicializa el servidor Socket.IO sobre un servidor HTTP existente.
     * Debe llamarse una sola vez en el bootstrap.
     */
    initialize(httpServer: HttpServer): SocketIOServer {
        if (this.io) return this.io;

        this.io = new SocketIOServer(httpServer, {
            cors: { origin: this.cfg.corsOrigin, methods: this.cfg.corsMethods },
        });

        this.io.on('connection', (socket) => {
            this.logger.info(`${MESSAGES.WEBSOCKET.CLIENT_CONNECTED}: ${socket.id}`);
            socket.on('disconnect', () => {
                this.logger.info(`${MESSAGES.WEBSOCKET.CLIENT_DISCONNECTED}: ${socket.id}`);
            });
            socket.emit('connected', {
                message: MESSAGES.WEBSOCKET.WELCOME,
                timestamp: new Date().toISOString(),
            });
        });

        return this.io;
    }

    /**
     * Difunde un evento `sensor-data` a todos los clientes conectados.
     */
    emitSensorData(data: ProcessedSensorData): void {
        if (!this.io) {
            this.logger.warn('SocketEmitterService no inicializado; evento descartado');
            return;
        }
        this.io.emit('sensor-data', data);
    }

    /**
     * Cierra el servidor de sockets. Idempotente.
     *
     * Capturamos `this.io` en una constante local para que el control de
     * flujo del compilador (narrowing) elimine el posible `null` sin
     * recurrir al operador `!` de aserción de no-nulo.
     */
    async close(): Promise<void> {
        const server = this.io;
        if (!server) return;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        this.io = null;
    }
}
