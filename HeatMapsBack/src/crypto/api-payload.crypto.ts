import crypto from 'crypto';
import { singleton } from 'tsyringe';
import { CryptoConfig } from '../config/crypto.config';

/**
 * Cifrado de los payloads que viajan entre la SPA y el backend.
 *
 * **Algoritmo**: AES-256-GCM (AEAD: confidencialidad + integridad).
 *
 * **Layout del string resultante** (base64):
 *
 *     base64( [ iv (12B) ][ authTag (16B) ][ ciphertext ] )
 *
 * Se elige GCM frente a CTR porque aquí controlamos ambas puntas y queremos
 * detección de manipulación (el `authTag` falla si alguien altera el ct).
 */
@singleton()
export class ApiPayloadCipher {
    constructor(private readonly cfg: CryptoConfig) {}

    /**
     * Cifra un objeto cualquiera serializable a JSON.
     */
    encrypt(data: unknown): string {
        const key = this.cfg.frontendEncryptionKey;
        const iv = crypto.randomBytes(12);
        const plain = JSON.stringify(data);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, ct]).toString('base64');
    }

    /**
     * Descifra un string base64 producido por {@link encrypt}.
     *
     * @throws Error si el authTag no valida (payload manipulado o clave incorrecta).
     */
    decrypt(data: string): unknown {
        const key = this.cfg.frontendEncryptionKey;
        const buf = Buffer.from(data, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const ct = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
        return JSON.parse(plain);
    }
}
