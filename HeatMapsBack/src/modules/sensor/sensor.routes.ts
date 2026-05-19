import { Router } from 'express';
import { container } from 'tsyringe';
import { SensorController } from './sensor.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';

/**
 * Construye el router del módulo de sensores (operaciones sobre el consumer
 * de Kafka). Se monta en `/kafka` desde `app.ts`.
 */
export function buildSensorRouter(): Router {
    const router = Router();
    const ctrl = container.resolve(SensorController);

    router.post('/start', asyncHandler(ctrl.start));
    router.post('/stop', asyncHandler(ctrl.stop));
    router.get('/status', ctrl.status);

    return router;
}
