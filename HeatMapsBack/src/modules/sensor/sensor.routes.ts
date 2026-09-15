import { Router } from 'express';
import { container } from 'tsyringe';
import { SensorController } from './sensor.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { adminRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requireRoot } from '../../middlewares/require-root.middleware';

/**
 * Construye el router del módulo de sensores (operaciones sobre el consumer
 * de Kafka). Se monta en `/kafka` desde `app.ts` y está bajo el
 * `adminRateLimiter` por ser un endpoint administrativo.
 *
 * Arrancar o detener el consumidor corta o reanuda la ingesta de todo el
 * sistema, así que exige el rol `root`; consultar su estado basta con estar
 * autenticado.
 */
export const buildSensorRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(SensorController);

    router.use(adminRateLimiter, authMiddleware);

    router.post('/start', requireRoot, asyncHandler(ctrl.start));
    router.post('/stop', requireRoot, asyncHandler(ctrl.stop));
    router.get('/status', ctrl.status);

    return router;
};
