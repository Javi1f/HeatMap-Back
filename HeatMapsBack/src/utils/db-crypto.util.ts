import crypto from 'crypto';

const getKey = (envVar: string): Buffer => {
    const hex = process.env[envVar];
    if (!hex || hex.length !== 64) {
        throw new Error(`Variable de entorno ${envVar} debe ser un hex de 64 caracteres (32 bytes)`);
    }
    return Buffer.from(hex, 'hex');
};

export function encryptField(value: string): string {
    const key = getKey('DB_ENCRYPTION_KEY');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptField(encrypted: string): string {
    const key = getKey('DB_ENCRYPTION_KEY');
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hashField(value: string): string {
    const key = getKey('DB_HMAC_KEY');
    return crypto.createHmac('sha256', key).update(value.toLowerCase().trim()).digest('hex');
}
