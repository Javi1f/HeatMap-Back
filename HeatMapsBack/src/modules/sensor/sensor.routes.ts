import { Router } from 'express';
import { container } from 'tsyringe';
import { SensorController } from './sensor.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { adminRateLimiter } from '../../common/middlewares/rate-limit.middleware';

/**
 * Construye el router del módulo de sensores (operaciones sobre el consumer
 * de Kafka). Se monta en `/kafka` desde `app.ts` y está bajo el
 * `adminRateLimiter` por ser un endpoint administrativo.
 */
export const buildSensorRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(SensorController);

    router.use(adminRateLimiter);

    router.post('/start', asyncHandler(ctrl.start));
    router.post('/stop', asyncHandler(ctrl.stop));
    router.get('/status', ctrl.status);

    return router;
};
