import crypto from 'crypto';
import { singleton } from 'tsyringe';
import { CryptoConfig } from '../config/crypto.config';

/**
 * Cifrado por campo para columnas sensibles en la base de datos.
 *
 * **Algoritmos**:
 *  - Confidencialidad: AES-256-GCM por campo, con IV aleatorio.
 *  - Búsqueda por igualdad: HMAC-SHA256 determinista sobre el valor
 *    normalizado (lowercase + trim).
 *
 * **Layout del string cifrado** (base64):
 *
 *     base64( [ iv (12B) ][ authTag (16B) ][ ciphertext ] )
 *
 * Los campos con índice único deben persistirse cifrados (para confidencialidad)
 * y también su HMAC en una columna paralela `*Hash` (para lookups O(1)).
 */
@singleton()
export class DbFieldCipher {
    constructor(private readonly cfg: CryptoConfig) {}

    /**
     * Cifra un string para almacenamiento en una columna `text`.
     */
    encrypt(value: string): string {
        const key = this.cfg.dbEncryptionKey;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, ct]).toString('base64');
    }

    /**
     * Descifra un valor cifrado por {@link encrypt}.
     *
     * @throws Error si el authTag no valida.
     */
    decrypt(encrypted: string): string {
        const key = this.cfg.dbEncryptionKey;
        const buf = Buffer.from(encrypted, 'base64');
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const ct = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    }

    /**
     * HMAC-SHA256 determinista para columnas indexables (`*Hash`).
     *
     * Normaliza con `lowercase().trim()` para que búsquedas case-insensitive
     * funcionen sin descifrar el campo principal.
     */
    hash(value: string): string {
        return crypto
            .createHmac('sha256', this.cfg.dbHmacKey)
            .update(value.toLowerCase().trim())
            .digest('hex');
    }
}
