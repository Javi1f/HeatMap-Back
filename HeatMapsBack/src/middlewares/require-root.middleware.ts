import { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import { ForbiddenError, UnauthorizedError } from '../common/errors';
import { AdminRepository } from '../modules/auth/repositories/admin.repository';
import type { Admin } from '../models/Admin.entity';

/** Lanza si la cuenta no existe, está desactivada o no tiene el rol `root`. */
const exigirRootActivo = (admin: Admin | null): void => {
    if (!admin?.activo) throw new UnauthorizedError('La cuenta está desactivada');
    if (admin.rol !== 'root') throw new ForbiddenError('Esta acción requiere el rol root');
};

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

        exigirRootActivo(await container.resolve(AdminRepository).findById(req.admin.id));

        next();
    } catch (err) {
        next(err);
    }
};
