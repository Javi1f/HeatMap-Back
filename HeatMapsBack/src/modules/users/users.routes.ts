import { Router } from 'express';
import { container } from 'tsyringe';
import { UsersController } from './users.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { validate } from '../../common/middlewares/validate.middleware';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRoot } from '../../middlewares/require-root.middleware';
import { adminRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import { adminIdParamSchema, auditoriaQuerySchema, cambiarActivoSchema, cambiarRolSchema } from './dto/usuarios.dto';

/**
 * Router de administración de usuarios, montado en `/api/users`.
 *
 * Todo el módulo exige el rol `root`: expone correos, IP de origen y la
 * capacidad de quitar el acceso a otras cuentas.
 *
 * Convive con `/api/allowed-emails`, que sigue siendo su propio módulo: la
 * lista blanca gobierna quién *puede* registrarse, mientras que este módulo
 * describe quién *ya está* dentro y desde dónde.
 */
export const buildUsersRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(UsersController);

    router.use(adminRateLimiter, authMiddleware, requireRoot);

    router.get('/admins', asyncHandler(ctrl.listAdmins));
    router.patch(
        '/admins/:id/rol',
        validate(adminIdParamSchema, 'params'),
        validate(cambiarRolSchema),
        asyncHandler(ctrl.cambiarRol),
    );
    router.patch(
        '/admins/:id/activo',
        validate(adminIdParamSchema, 'params'),
        validate(cambiarActivoSchema),
        asyncHandler(ctrl.cambiarActivo),
    );
    router.get('/sessions', asyncHandler(ctrl.listSessions));
    router.delete('/sessions/:id', asyncHandler(ctrl.revokeSession));
    router.get('/auditoria', validate(auditoriaQuerySchema, 'query'), asyncHandler(ctrl.listarAuditoria));

    return router;
};
