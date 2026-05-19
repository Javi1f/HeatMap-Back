import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { JwtService } from '../modules/auth/services/jwt.service';
import { UnauthorizedError } from '../common/errors';

/**
 * Middleware de autenticación basado en JWT (`Authorization: Bearer <token>`).
 *
 * Si el token es válido, popula `req.admin` con el payload tipado y delega
 * en `next()`. Si falta o es inválido, propaga un {@link UnauthorizedError}
 * al `errorHandler` central — NUNCA escribe directamente en `res`, porque
 * eso duplicaría el formateo de errores.
 *
 * El middleware resuelve `JwtService` del contenedor para no acoplarse a
 * `AuthService` y permitir testear el middleware de forma aislada.
 */
export const authMiddleware = (
    req: Request,
    _res: Response,
    next: NextFunction,
): void => {
    try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
            throw new UnauthorizedError('Token no proporcionado');
        }
        const token = header.slice('Bearer '.length).trim();
        if (!token) throw new UnauthorizedError('Token vacío');

        const jwt = container.resolve(JwtService);
        req.admin = jwt.verify(token);
        next();
    } catch (err) {
        next(err);
    }
};
