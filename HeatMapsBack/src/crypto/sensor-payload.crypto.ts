import crypto from 'crypto';
import { singleton } from 'tsyringe';
import { CryptoConfig } from '../config/crypto.config';
import { SensorPayload } from '../types/sensor.types';

/**
 * Cifrado de payloads de sensores que viajan por Kafka.
 *
 * **Algoritmo**: AES-256-CTR en cascada de dos capas, con dos claves y dos
 * nonces independientes. Solo confidencialidad (no autenticación: el
 * productor está en un lenguaje distinto y se eligió este esquema por
 * compatibilidad).
 *
 * **Layout del buffer cifrado**:
 *
 *     [ nonce1 (8B) ][ nonce2 (8B) ][ ciphertext doble capa ]
 *
 * **Orden de aplicación**:
 *  - Cifrado: plaintext → capa1 (KEY_1, nonce1) → capa2 (KEY_2, nonce2).
 *  - Descifrado: invertido.
 *
 * El nonce de 8 bytes se rellena a la izquierda en un IV de 16 bytes (los
 * 8 restantes son el contador inicial del modo CTR).
 */
@singleton()
export class SensorPayloadCipher {
    constructor(private readonly cfg: CryptoConfig) {}

    /**
     * Cifra un payload de sensor.
     *
     * @param payload - Objeto serializable a JSON.
     * @returns Buffer con el layout descrito arriba.
     */
    encrypt(payload: SensorPayload): Buffer {
        const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
        const nonce1 = crypto.randomBytes(this.cfg.kafkaNonceSize);
        const nonce2 = crypto.randomBytes(this.cfg.kafkaNonceSize);
        const layer1 = this.ctr(this.cfg.kafkaKey1, nonce1, plaintext);
        const layer2 = this.ctr(this.cfg.kafkaKey2, nonce2, layer1);
        return Buffer.concat([nonce1, nonce2, layer2]);
    }

    /**
     * Descifra un buffer recibido desde Kafka.
     *
     * @throws Error si el buffer es demasiado corto o el JSON resultante es inválido.
     */
    decrypt(raw: Buffer): SensorPayload {
        const nSize = this.cfg.kafkaNonceSize;
        if (raw.length < nSize * 2 + 1) {
            throw new Error('Mensaje cifrado demasiado corto');
        }
        const nonce1 = raw.subarray(0, nSize);
        const nonce2 = raw.subarray(nSize, nSize * 2);
        const ct = raw.subarray(nSize * 2);

        const layer1 = this.ctr(this.cfg.kafkaKey2, nonce2, ct);
        const plain = this.ctr(this.cfg.kafkaKey1, nonce1, layer1);

        return JSON.parse(plain.toString('utf-8')) as SensorPayload;
    }

    /**
     * Operación AES-256-CTR. Es simétrica: la misma rutina cifra y descifra.
     */
    private ctr(key: Buffer, nonce: Buffer, data: Buffer): Buffer {
        const iv = Buffer.alloc(16);
        nonce.copy(iv, 0);
        const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    }
}
