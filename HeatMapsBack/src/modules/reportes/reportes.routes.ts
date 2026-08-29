import { Router } from 'express';
import { container } from 'tsyringe';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { validate } from '../../common/middlewares/validate.middleware';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { adminRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import { crearReporteSchema, reporteIdParamSchema } from './dto/reporte.dto';
import { ReportesController } from './reportes.controller';

/**
 * Router del módulo de reportes, montado en `/api/reportes`.
 *
 * Usa el limitador administrativo y no el de sondeo: estas rutas las dispara
 * una persona al pulsar un botón, no un temporizador.
 */
export const buildReportesRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(ReportesController);

    router.use(adminRateLimiter, authMiddleware);

    router.post('/', validate(crearReporteSchema), asyncHandler(ctrl.crear));
    router.get('/', asyncHandler(ctrl.listar));
    router.get('/:id', validate(reporteIdParamSchema, 'params'), asyncHandler(ctrl.obtener));
    router.get('/:id/csv', validate(reporteIdParamSchema, 'params'), asyncHandler(ctrl.exportarCsv));
    router.delete('/:id', validate(reporteIdParamSchema, 'params'), asyncHandler(ctrl.eliminar));

    return router;
};
