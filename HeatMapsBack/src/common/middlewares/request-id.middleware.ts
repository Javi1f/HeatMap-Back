import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

/**
 * Asigna un identificador único a cada petición y lo expone tanto en
 * `req.requestId` como en la cabecera de respuesta `X-Request-Id`.
 *
 * Sirve para correlacionar logs cuando varias peticiones entran en paralelo.
 *
 * Respeta una cabecera entrante `X-Request-Id` si viene del cliente o de un
 * proxy upstream, evitando romper el rastreo distribuido.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('X-Request-Id');
    const id = incoming && incoming.length > 0 ? incoming : crypto.randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
}
