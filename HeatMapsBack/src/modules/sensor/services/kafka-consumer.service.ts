import { injectable } from 'tsyringe';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { KafkaConfig } from '../../../config/kafka.config';
import { SensorPayloadCipher } from '../../../crypto/sensor-payload.crypto';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData, SensorPayload } from '../../../types/sensor.types';
import { MESSAGES } from '../../../constants/messages';
import { DataProcessorService } from './data-processor.service';
import { SocketEmitterService } from './socket-emitter.service';

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
 */
@injectable()
export class KafkaConsumerService {
    private kafka: Kafka | null = null;
    private consumer: Consumer | null = null;
    private isRunning = false;

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

        this.consumer = this.kafka.consumer({ groupId: this.cfg.groupId });
        await this.consumer.connect();
        await this.consumer.subscribe({ topic: this.cfg.topic, fromBeginning: false });
        await this.consumer.run({
            eachMessage: (payload: EachMessagePayload) => this.handleMessage(payload),
        });

        this.isRunning = true;
        this.logger.info(MESSAGES.CONSUMER.STARTED);
    }

    /**
     * Detiene el consumidor. Idempotente.
     */
    async stop(): Promise<void> {
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

            const processed = this.normalize(data, message.value.length);
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

    /**
     * Adapta `SensorPayload` (formato del productor) al `ProcessedSensorData`
     * que se consume internamente y se emite a los clientes.
     */
    private normalize(data: SensorPayload, bytesReceived: number): ProcessedSensorData {
        return {
            sensor_id: data.sensor_id || '?',
            total_devices: data.total_devices || 0,
            timestamp: new Date(data.timestamp * 1000).toLocaleTimeString('es-ES'),
            timestamp_raw: data.timestamp,
            bytes_received: bytesReceived,
            devices: data.devices || [],
            received_at: new Date().toISOString(),
        };
    }
}
