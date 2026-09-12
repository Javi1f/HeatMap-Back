import { singleton } from 'tsyringe';
import { Consumer, ConsumerCrashEvent, ConsumerGroupJoinEvent, EachMessagePayload, Kafka } from 'kafkajs';
import { KafkaConfig } from '../../../config/kafka.config';
import { SensorPayloadCipher } from '../../../crypto/sensor-payload.crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData, SensorPayload } from '../../../types/sensor.types';
import { MESSAGES } from '../../../constants/messages';
import { DataProcessorService } from './data-processor.service';
import { SocketEmitterService } from './socket-emitter.service';

/**
 * Adapta `SensorPayload` (formato del productor Kafka) al
 * `ProcessedSensorData` que se consume internamente y se emite a los clientes.
 *
 * Es una función pura (no depende del estado del consumer), por eso vive a
 * nivel de módulo en lugar de como método de clase.
 *
 * @param data - Payload tal como llegó del sensor.
 * @param bytesReceived - Bytes ocupados por el mensaje cifrado en Kafka.
 */
const normalizeSensorPayload = (
    data: SensorPayload,
    bytesReceived: number,
): ProcessedSensorData => ({
    sensor_id: data.sensor_id || '?',
    total_devices: data.total_devices || 0,
    timestamp: new Date(data.timestamp * 1000).toLocaleTimeString('es-ES'),
    timestamp_raw: data.timestamp,
    bytes_received: bytesReceived,
    devices: data.devices || [],
    received_at: new Date().toISOString(),
});

/** Primera espera antes de reintentar tras una caída del consumer, en milisegundos. */
const ESPERA_INICIAL_MS = 5_000;

/** Tope de la espera entre reintentos, en milisegundos. */
const ESPERA_MAXIMA_MS = 60_000;

/** Tipo de error de Kafka cuando los miembros de un grupo no comparten asignador. */
const PROTOCOLO_INCOMPATIBLE = 'INCONSISTENT_GROUP_PROTOCOL';

/** Error de kafkajs con los campos opcionales que usa para encadenar causas. */
type ErrorKafka = Error & { cause?: Error; type?: string };

/**
 * Error que originó una caída.
 *
 * kafkajs envuelve el error del protocolo en varias capas, y el tipo que
 * explica la caída —como `INCONSISTENT_GROUP_PROTOCOL`— sólo está en la más
 * interna.
 */
const causaOriginal = (error: Error): ErrorKafka => {
    let actual: ErrorKafka = error;
    while (actual.cause) actual = actual.cause;
    return actual;
};

/**
 * Consumidor del topic de Kafka donde los sensores publican lecturas WiFi.
 *
 * Responsabilidades:
 *  1. Suscribirse al topic configurado y consumir en streaming.
 *  2. Descartar mensajes históricos (más viejos que `maxMessageAgeSeconds`).
 *  3. Descifrar cada payload (delegando en {@link SensorPayloadCipher}).
 *  4. Normalizar el payload a {@link ProcessedSensorData}.
 *  5. Delegar persistencia/procesamiento a {@link DataProcessorService}.
 *  6. Difundir el evento a clientes WebSocket vía {@link SocketEmitterService}.
 *
 * NO contiene lógica de negocio sobre los datos en sí — solo orquesta el
 * pipeline ingreso → proceso → notificación.
 *
 * Alcance único: la conexión y el estado `isRunning` describen un proceso, no
 * una petición. Con alcance transitorio, el controlador que responde a
 * `/kafka/status` consultaría una instancia distinta de la que consume, e
 * informaría siempre de que está detenida.
 *
 * **Caídas**: kafkajs sólo se reinicia solo ante errores recuperables. Ante uno
 * que no lo es —el broker rechaza al consumer porque otro cliente del grupo
 * negoció un asignador distinto— se desconecta y no vuelve a intentarlo, y el
 * servidor HTTP sigue respondiendo como si nada. Por eso el servicio escucha
 * la caída, la registra con su causa y reintenta con espera creciente.
 */
@singleton()
export class KafkaConsumerService {
    /** Cliente de KafkaJS. Se crea una sola vez y se reutiliza. */
    private kafka: Kafka | null = null;

    /** Consumidor activo, o `null` mientras esta detenido. */
    private consumer: Consumer | null = null;

    /** Estado interno que hace idempotentes a `start` y `stop`. */
    private isRunning = false;

    /** Temporizador del próximo reintento, o `null` si no hay ninguno pendiente. */
    private reintento: ReturnType<typeof setTimeout> | null = null;

    /** Espera del próximo reintento; se duplica con cada fallo seguido. */
    private esperaMs = ESPERA_INICIAL_MS;

    /** Identificador del cliente ante el broker, visible en sus metricas. */
    private static readonly CLIENT_ID = 'sensor-consumer';

    constructor(
        private readonly cfg: KafkaConfig,
        private readonly cipher: SensorPayloadCipher,
        private readonly processor: DataProcessorService,
        private readonly emitter: SocketEmitterService,
        private readonly logger: LoggerService,
    ) {}

    /** @returns true si el consumer está conectado y consumiendo. */
    get running(): boolean {
        return this.isRunning;
    }

    /**
     * Inicia el consumidor. Idempotente: si ya corre, no hace nada.
     *
     * @throws Cualquier error de conexión a Kafka.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn(MESSAGES.CONSUMER.ALREADY_RUNNING);
            return;
        }

        this.kafka ??= new Kafka({
            clientId: KafkaConsumerService.CLIENT_ID,
            brokers: this.cfg.brokers,
            ssl: this.cfg.ssl,
        });

        const consumer = this.kafka.consumer({ groupId: this.cfg.groupId });
        this.consumer = consumer;
        consumer.on(consumer.events.GROUP_JOIN, (evento) => this.alUnirseAlGrupo(evento));
        consumer.on(consumer.events.CRASH, (evento) => this.alCaer(consumer, evento));
        await consumer.connect();
        await consumer.subscribe({ topic: this.cfg.topic, fromBeginning: false });
        await consumer.run({
            eachMessage: (payload: EachMessagePayload) => this.handleMessage(payload),
        });

        // La primera unión al grupo ocurre dentro de `run`. Si fracasó sin
        // remedio, `alCaer` ya descartó este consumer y programó el reintento:
        // marcarlo ahora como activo taparía la caída y bloquearía el reintento.
        if (this.consumer !== consumer) return;

        this.isRunning = true;
        this.logger.info(MESSAGES.CONSUMER.STARTED);
    }

    /**
     * Detiene el consumidor. Idempotente.
     */
    async stop(): Promise<void> {
        if (this.reintento) {
            clearTimeout(this.reintento);
            this.reintento = null;
        }
        if (!this.isRunning || !this.consumer) {
            this.logger.warn(MESSAGES.CONSUMER.NOT_RUNNING);
            return;
        }
        await this.consumer.disconnect();
        this.consumer = null;
        this.isRunning = false;
        this.logger.info(MESSAGES.CONSUMER.STOPPED);
    }

    /**
     * Registra a qué particiones quedó asignado el consumer.
     *
     * Unirse sin particiones no es un error: significa que otra instancia del
     * mismo grupo las está leyendo. Se avisa porque, visto desde fuera, es
     * indistinguible de un backend que no recibe nada.
     */
    private alUnirseAlGrupo({ payload }: ConsumerGroupJoinEvent): void {
        this.esperaMs = ESPERA_INICIAL_MS;
        const particiones = payload.memberAssignment[this.cfg.topic] ?? [];

        if (particiones.length === 0) {
            this.logger.warn(`${MESSAGES.CONSUMER.NO_PARTITIONS} (${payload.groupId})`);
            return;
        }
        this.logger.info(
            `${MESSAGES.CONSUMER.GROUP_JOINED} ${payload.groupId}, particiones [${particiones.join(', ')}]`,
        );
    }

    /**
     * Registra una caída y, si kafkajs no va a reiniciarse solo, programa el
     * reintento.
     *
     * Se ignoran las caídas de un consumer que ya no es el vigente: sin esa
     * comprobación, un evento tardío de un intento anterior descartaría al
     * consumer que sí funciona.
     */
    private alCaer(consumer: Consumer, { payload }: ConsumerCrashEvent): void {
        if (consumer !== this.consumer) return;

        const causa = causaOriginal(payload.error);
        const pista = causa.type === PROTOCOLO_INCOMPATIBLE ? ` ${MESSAGES.CONSUMER.INCOMPATIBLE_GROUP}` : '';
        this.logger.error(`${MESSAGES.CONSUMER.CRASHED} (${payload.groupId}): ${causa.message}.${pista}`);

        if (payload.restart) return;

        this.isRunning = false;
        this.consumer = null;
        this.programarReintento();
    }

    /**
     * Vuelve a iniciar el consumer tras una espera que se duplica con cada
     * fallo seguido, hasta {@link ESPERA_MAXIMA_MS}.
     *
     * La espera creciente evita martillear al broker cuando la causa es
     * persistente, como un grupo compartido con un cliente incompatible, sin
     * renunciar a recuperarse sola cuando la causa desaparece.
     */
    private programarReintento(): void {
        if (this.reintento) return;

        const espera = this.esperaMs;
        this.esperaMs = Math.min(this.esperaMs * 2, ESPERA_MAXIMA_MS);
        this.logger.warn(`${MESSAGES.CONSUMER.RESTARTING} ${Math.round(espera / 1000)} s`);

        this.reintento = setTimeout(() => {
            this.reintento = null;
            this.start().catch((err: unknown) => {
                this.logger.error(MESSAGES.CONSUMER.START_ERROR, err);
                this.programarReintento();
            });
        }, espera);
    }

    /**
     * Maneja un mensaje individual. Captura todos los errores aquí para no
     * derribar el consumer si un mensaje viene corrupto.
     */
    private async handleMessage({ message }: EachMessagePayload): Promise<void> {
        try {
            if (!message.value) {
                this.logger.warn(MESSAGES.KAFKA.EMPTY_MESSAGE);
                return;
            }

            const data = this.cipher.decrypt(message.value);
            if (this.isStale(data)) return;

            const processed = normalizeSensorPayload(data, message.value.length);
            this.logger.info(
                `${MESSAGES.KAFKA.DATA_RECEIVED}: Sensor ${processed.sensor_id} | ${processed.total_devices} dispositivos`,
            );

            await this.processor.processAndSave(processed);
            this.emitter.emitSensorData(processed);
            this.logger.debug(MESSAGES.KAFKA.DATA_SENT);
        } catch (err) {
            this.logger.error(MESSAGES.KAFKA.DECRYPT_ERROR, err);
        }
    }

    /**
     * @returns true si el mensaje es más antiguo que el umbral configurado.
     */
    private isStale(data: SensorPayload): boolean {
        const age = Date.now() / 1000 - data.timestamp;
        if (age > this.cfg.maxMessageAgeSeconds) {
            this.logger.debug(
                `Mensaje histórico descartado (${Math.round(age)}s) sensor=${data.sensor_id}`,
            );
            return true;
        }
        return false;
    }
}
