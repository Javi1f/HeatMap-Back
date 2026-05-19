import { Router } from 'express';
import { container } from 'tsyringe';
import { AuthController } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import { verifyCodeSchema } from './dto/verify-code.dto';
import { cancelVerificationSchema } from './dto/cancel-verification.dto';

/**
 * Construye el router del módulo de autenticación.
 *
 * Cada ruta declara explícitamente:
 *  - El esquema de validación de su body (Zod).
 *  - Si requiere autenticación.
 *  - El handler envuelto en `asyncHandler` para propagar errores.
 */
export function buildAuthRouter(): Router {
    const router = Router();
    const ctrl = container.resolve(AuthController);

    router.post('/login', validate(loginSchema), asyncHandler(ctrl.login));
    router.post('/register', validate(registerSchema), asyncHandler(ctrl.register));
    router.post('/verify-code', validate(verifyCodeSchema), asyncHandler(ctrl.verifyCode));
    router.post(
        '/cancel-verification',
        validate(cancelVerificationSchema),
        asyncHandler(ctrl.cancelVerification),
    );
    router.post('/logout', authMiddleware, ctrl.logout);
    router.get('/session', authMiddleware, ctrl.session);

    return router;
}
