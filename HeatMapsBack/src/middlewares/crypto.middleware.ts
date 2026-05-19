import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { ApiPayloadCipher } from '../crypto/api-payload.crypto';
import { ValidationError } from '../common/errors';

/**
 * Middleware que **descifra** el body de la petición entrante.
 *
 * Espera un body de la forma `{ "data": "<base64>" }`. Tras descifrar,
 * sustituye `req.body` por el payload original. Si no hay `body.data`,
 * deja la petición pasar sin tocarla (útil para endpoints que no usan
 * cifrado pero comparten el mismo prefijo `/api`).
 *
 * Si el payload está mal cifrado, lanza un {@link ValidationError} para
 * que el `errorHandler` central responda 400.
 */
export const decryptRequest = (
    req: Request,
    _res: Response,
    next: NextFunction,
): void => {
    if (!req.body || !req.body.data) {
        next();
        return;
    }
    try {
        const cipher = container.resolve(ApiPayloadCipher);
        req.body = cipher.decrypt(req.body.data as string);
        next();
    } catch {
        next(new ValidationError('Payload cifrado inválido o clave incorrecta'));
    }
};

/**
 * Middleware que **cifra** el body de la respuesta antes de enviarla.
 *
 * Intercepta `res.json(body)` y lo reemplaza por `res.json({ data: cipher(body) })`.
 * La intercepción se hace una sola vez por petición y respeta el tipo de
 * retorno original.
 */
export const encryptResponse = (
    _req: Request,
    res: Response,
    next: NextFunction,
): void => {
    const cipher = container.resolve(ApiPayloadCipher);
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
        return originalJson({ data: cipher.encrypt(body) });
    };
    next();
};
