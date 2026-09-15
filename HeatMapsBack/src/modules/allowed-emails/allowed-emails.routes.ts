import { Router } from 'express';
import { container } from 'tsyringe';
import { AllowedEmailsController } from './allowed-emails.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRoot } from '../../middlewares/require-root.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { generalRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import {
    addAllowedEmailSchema,
    allowedEmailIdParamSchema,
} from './dto/add-email.dto';

/**
 * Construye el router del módulo de correos permitidos.
 * Todas las rutas requieren el rol `root` —la lista blanca decide quién puede
 * convertirse en administrador— y están bajo el `generalRateLimiter`.
 */
export const buildAllowedEmailsRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(AllowedEmailsController);

    router.use(generalRateLimiter, authMiddleware, requireRoot);

    router.get('/', asyncHandler(ctrl.getAll));
    router.post(
        '/',
        validate(addAllowedEmailSchema),
        asyncHandler(ctrl.add),
    );
    router.delete(
        '/:id',
        validate(allowedEmailIdParamSchema, 'params'),
        asyncHandler(ctrl.remove),
    );

    return router;
};
