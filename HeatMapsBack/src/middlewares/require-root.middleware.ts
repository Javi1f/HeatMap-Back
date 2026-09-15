import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { ForbiddenError, UnauthorizedError } from '../common/errors';
import { AdminRepository } from '../modules/auth/repositories/admin.repository';

/**
 * Exige que el administrador autenticado tenga el rol `root` y esté activo.
 *
 * Va siempre después de `authMiddleware`. El rol se consulta en la base de
 * datos en cada petición en lugar de leerse del token: un token vive hasta una
 * hora, y retirar el rol a alguien no puede esperar a que caduque.
 */
export const requireRoot = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
        if (!req.admin) throw new UnauthorizedError();

        const admin = await container.resolve(AdminRepository).findById(req.admin.id);
        if (!admin?.activo) throw new UnauthorizedError('La cuenta está desactivada');
        if (admin.rol !== 'root') throw new ForbiddenError('Esta acción requiere el rol root');

        next();
    } catch (err) {
        next(err);
    }
};
