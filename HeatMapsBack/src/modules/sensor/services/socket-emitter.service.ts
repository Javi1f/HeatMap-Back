import { singleton } from 'tsyringe';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { SocketConfig } from '../../../config/socket.config';
import { ApiPayloadCipher } from '../../../crypto/api-payload.crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData, ResumenSensor } from '../../../types/sensor.types';
import { MESSAGES } from '../../../constants/messages';

/**
 * Servicio responsable de difundir eventos en tiempo real a los clientes
 * conectados por Socket.IO.
 *
 * Reemplaza el anti-patrón de tener variables globales (`io`) y funciones
 * sueltas (`emitSensorData`) en `socket.config.ts`. Ahora el estado
 * vive dentro de una instancia gestionada por el contenedor DI.
 *
 * Alcance único: el servidor de Socket.IO que guarda esta clase se crea una
 * sola vez en el arranque. Con alcance transitorio, quien lo inicializa y quien
 * emite reciben instancias distintas, y la que emite tiene `io` a `null`: los
 * eventos se descartan sin que nada falle de forma visible.
 */
@singleton()
export class SocketEmitterService {
    /** Servidor de Socket.IO, o `null` antes de inicializar o tras cerrar. */
    private io: SocketIOServer | null = null;

    constructor(
        private readonly cfg: SocketConfig,
        private readonly cipher: ApiPayloadCipher,
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
                data: this.cipher.encrypt({
                    message: MESSAGES.WEBSOCKET.WELCOME,
                    timestamp: new Date().toISOString(),
                }),
            });
        });

        return this.io;
    }

    /**
     * Difunde el resumen de una lectura a todos los clientes conectados.
     *
     * **Difunde un resumen, no la lectura.** El canal no exige autenticación:
     * cualquiera que abra una conexión recibe lo que se emita. Publicar
     * `data.devices` entregaría la dirección de cada dispositivo detectado a
     * cualquier visitante, que podría seguir a una persona por el campus. Lo
     * que sale de aquí es el conteo por nodo, sin identificadores.
     *
     * El resumen se construye campo a campo a propósito: si mañana
     * `ProcessedSensorData` gana un campo sensible, no se filtra solo por
     * haberse añadido.
     *
     * **Va cifrado con AES-256-GCM**, el mismo algoritmo y la misma clave que
     * los payloads de la API REST, de modo que ningún dato sale del backend en
     * claro por ninguno de los dos canales. El sobre es idéntico al de la API
     * (`{ data: "<base64>" }`), así que el cliente descifra con el mismo
     * servicio que ya usa para las respuestas HTTP.
     */
    emitSensorData(data: ProcessedSensorData): void {
        if (!this.io) {
            this.logger.warn('SocketEmitterService no inicializado; evento descartado');
            return;
        }

        const resumen: ResumenSensor = {
            sensor_id: data.sensor_id,
            total_devices: data.total_devices,
            timestamp: data.timestamp,
            received_at: data.received_at,
        };

        this.io.emit('sensor-data', { data: this.cipher.encrypt(resumen) });
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
