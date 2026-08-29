import { Router } from 'express';
import { container } from 'tsyringe';
import { MetricsController } from './metrics.controller';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { pollingRateLimiter } from '../../common/middlewares/rate-limit.middleware';

/**
 * Router del módulo de métricas, montado en `/api/metrics`.
 *
 * Todo el módulo exige autenticación: son datos de operación institucional
 * (ocupación por espacio, salud de la infraestructura) que no forman parte de
 * la sección pública.
 *
 * Usa {@link pollingRateLimiter} y no el limitador administrativo porque el
 * dashboard consulta estas rutas en bucle mientras está abierto; con la cuota
 * de acciones manuales se agotaría en minutos y arrastraría consigo al resto
 * de pantallas que comparten ese contador.
 */
export const buildMetricsRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(MetricsController);

    router.use(pollingRateLimiter, authMiddleware);

    router.get('/overview', asyncHandler(ctrl.overview));
    router.get('/zones', asyncHandler(ctrl.zones));
    router.get('/occupancy', asyncHandler(ctrl.occupancy));
    router.get('/sensors', asyncHandler(ctrl.sensors));
    router.get('/alerts', asyncHandler(ctrl.alerts));
    router.post('/alerts/:id/resolve', asyncHandler(ctrl.resolveAlert));
    router.get('/parameters', ctrl.parameters);

    return router;
};
