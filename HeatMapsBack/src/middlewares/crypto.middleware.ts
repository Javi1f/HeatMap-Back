import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const getKey = (): Buffer => {
    const hex = process.env.FRONTEND_ENCRYPTION_KEY;
    if (!hex || hex.length !== 64) {
        throw new Error('FRONTEND_ENCRYPTION_KEY debe ser un hex de 64 caracteres (32 bytes)');
    }
    return Buffer.from(hex, 'hex');
};

function encryptPayload(data: unknown): string {
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const plain = JSON.stringify(data);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptPayload(data: string): unknown {
    const key = getKey();
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
}

export function decryptRequest(req: Request, res: Response, next: NextFunction): void {
    if (!req.body || !req.body.data) {
        next();
        return;
    }
    try {
        req.body = decryptPayload(req.body.data as string);
        next();
    } catch {
        res.status(400).json({ message: 'Payload cifrado inválido o clave incorrecta' });
    }
}

export function encryptResponse(req: Request, res: Response, next: NextFunction): void {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        return originalJson({ data: encryptPayload(body) });
    };
    next();
}
