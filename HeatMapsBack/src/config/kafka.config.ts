import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Configuración de conexión a Kafka.
 *
 * Solo expone parámetros de **transporte** (brokers, topic, SSL, group id).
 * Las claves AES de cifrado de payloads se gestionan en `CryptoConfig`.
 */
@singleton()
export class KafkaConfig {
    /** Brokers del cluster, ya separados y recortados. */
    public readonly brokers: string[];

    /** Topic del que se consumen las lecturas de los nodos. */
    public readonly topic: string;

    /** Grupo de consumidores, que determina el reparto de particiones. */
    public readonly groupId: string;

    /** Antiguedad maxima admitida en un mensaje, en segundos. */
    public readonly maxMessageAgeSeconds: number;

    /** Autoridad certificadora del broker. */
    private readonly _ca: Buffer;

    /** Certificado de cliente. */
    private readonly _cert: Buffer;

    /** Clave privada del certificado de cliente. */
    private readonly _key: Buffer;

    constructor(env: EnvService) {
        this.brokers = env.get('KAFKA_BOOTSTRAP_SERVERS').split(',').map((s) => s.trim());
        this.topic = env.get('KAFKA_TOPIC').trim();
        this.groupId = env.get('KAFKA_GROUP_ID').trim();
        this.maxMessageAgeSeconds = env.get('KAFKA_MAX_MESSAGE_AGE_SECONDS');

        this._ca = Buffer.from(env.get('KAFKA_SSL_CA'), 'base64');
        this._cert = Buffer.from(env.get('KAFKA_SSL_CERT'), 'base64');
        this._key = Buffer.from(env.get('KAFKA_SSL_KEY'), 'base64');
    }

    /**
     * Configuración SSL en el formato esperado por `kafkajs`.
     */
    get ssl(): {
        rejectUnauthorized: boolean;
        ca: Buffer[];
        cert: Buffer;
        key: Buffer;
    } {
        return {
            rejectUnauthorized: true,
            ca: [this._ca],
            cert: this._cert,
            key: this._key,
        };
    }
}
