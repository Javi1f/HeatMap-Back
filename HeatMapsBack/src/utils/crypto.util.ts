import crypto from 'crypto';
import { AES_KEY_1, AES_KEY_2, NONCE_SIZE } from '../config/kafka.config';
import { SensorPayload } from '../types/sensor.types';

function aesCtrEncrypt(key: Buffer, nonce: Buffer, data: Buffer): Buffer {
    const iv = Buffer.alloc(16);
    nonce.copy(iv, 0);
    const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

function aesCtrDecrypt(key: Buffer, nonce: Buffer, data: Buffer): Buffer {
    const iv = Buffer.alloc(16);
    nonce.copy(iv, 0);
    const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
}

export function encrypt(payload: SensorPayload): Buffer {
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf-8');
    const nonce1 = crypto.randomBytes(NONCE_SIZE);
    const nonce2 = crypto.randomBytes(NONCE_SIZE);
    const afterLayer1 = aesCtrEncrypt(AES_KEY_1, nonce1, plaintext);
    const afterLayer2 = aesCtrEncrypt(AES_KEY_2, nonce2, afterLayer1);
    return Buffer.concat([nonce1, nonce2, afterLayer2]);
}

export function decrypt(raw: Buffer): SensorPayload {
    if (raw.length < NONCE_SIZE * 2 + 1) {
        throw new Error(`Mensaje demasiado corto`);
    }

    const nonce1 = raw.slice(0, NONCE_SIZE);
    const nonce2 = raw.slice(NONCE_SIZE, NONCE_SIZE * 2);
    const ciphertext = raw.slice(NONCE_SIZE * 2);

    const afterLayer2 = aesCtrDecrypt(AES_KEY_2, nonce2, ciphertext);
    const plaintext = aesCtrDecrypt(AES_KEY_1, nonce1, afterLayer2);

    return JSON.parse(plaintext.toString('utf-8'));
}
