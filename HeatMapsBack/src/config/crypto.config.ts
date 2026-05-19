import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Claves criptográficas usadas por el paquete `src/crypto/`.
 *
 * Centraliza la carga y memoización de los buffers de clave, evitando
 * convertir el hex a Buffer en cada operación de cifrado.
 *
 * **No exportar estos buffers fuera del paquete `crypto/`** — los servicios
 * de dominio nunca deberían tocar claves directamente.
 */
@singleton()
export class CryptoConfig {
    private readonly _dbEncryptionKey: Buffer;
    private readonly _dbHmacKey: Buffer;
    private readonly _frontendEncryptionKey: Buffer;
    private readonly _kafkaKey1: Buffer;
    private readonly _kafkaKey2: Buffer;

    /** Tamaño del nonce usado por el cifrado de payloads de Kafka (bytes). */
    public readonly kafkaNonceSize = 8;

    constructor(env: EnvService) {
        this._dbEncryptionKey = Buffer.from(env.get('DB_ENCRYPTION_KEY'), 'hex');
        this._dbHmacKey = Buffer.from(env.get('DB_HMAC_KEY'), 'hex');
        this._frontendEncryptionKey = Buffer.from(env.get('FRONTEND_ENCRYPTION_KEY'), 'hex');
        this._kafkaKey1 = Buffer.from(env.get('AES_KEY_1'), 'hex');
        this._kafkaKey2 = Buffer.from(env.get('AES_KEY_2'), 'hex');
    }

    /** Clave AES-256-GCM para cifrar campos sensibles en la base de datos. */
    get dbEncryptionKey(): Buffer {
        return this._dbEncryptionKey;
    }

    /** Clave HMAC-SHA256 para hashing determinista de campos buscables. */
    get dbHmacKey(): Buffer {
        return this._dbHmacKey;
    }

    /** Clave AES-256-GCM para cifrar payloads request/response del frontend. */
    get frontendEncryptionKey(): Buffer {
        return this._frontendEncryptionKey;
    }

    /** Primera clave AES-256-CTR de la cascada de cifrado de Kafka. */
    get kafkaKey1(): Buffer {
        return this._kafkaKey1;
    }

    /** Segunda clave AES-256-CTR de la cascada de cifrado de Kafka. */
    get kafkaKey2(): Buffer {
        return this._kafkaKey2;
    }
}
