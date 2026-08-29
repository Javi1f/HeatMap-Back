import { Router } from 'express';
import { container } from 'tsyringe';
import { UsersController } from './users.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { adminRateLimiter } from '../../common/middlewares/rate-limit.middleware';

/**
 * Router de administración de usuarios, montado en `/api/users`.
 *
 * Convive con `/api/allowed-emails`, que sigue siendo su propio módulo: la
 * lista blanca gobierna quién *puede* registrarse, mientras que este módulo
 * describe quién *ya está* dentro y desde dónde.
 */
export const buildUsersRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(UsersController);

    router.use(adminRateLimiter, authMiddleware);

    router.get('/admins', asyncHandler(ctrl.listAdmins));
    router.get('/sessions', asyncHandler(ctrl.listSessions));
    router.delete('/sessions/:id', asyncHandler(ctrl.revokeSession));

    return router;
};
