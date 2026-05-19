import { Router } from 'express';
import { container } from 'tsyringe';
import { AllowedEmailsController } from './allowed-emails.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { generalRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import {
    addAllowedEmailSchema,
    allowedEmailIdParamSchema,
} from './dto/add-email.dto';

/**
 * Construye el router del módulo de correos permitidos.
 * Todas las rutas requieren admin autenticado y están bajo el
 * `generalRateLimiter`.
 */
export const buildAllowedEmailsRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(AllowedEmailsController);

    router.use(generalRateLimiter);

    router.get('/', authMiddleware, asyncHandler(ctrl.getAll));
    router.post(
        '/',
        authMiddleware,
        validate(addAllowedEmailSchema),
        asyncHandler(ctrl.add),
    );
    router.delete(
        '/:id',
        authMiddleware,
        validate(allowedEmailIdParamSchema, 'params'),
        asyncHandler(ctrl.remove),
    );

    return router;
};
