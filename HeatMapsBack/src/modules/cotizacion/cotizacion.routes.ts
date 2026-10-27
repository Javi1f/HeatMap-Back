import { Router } from 'express';
import { container } from 'tsyringe';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { validate } from '../../common/middlewares/validate.middleware';
import {
    adminRateLimiter,
    cotizacionRateLimiter,
} from '../../common/middlewares/rate-limit.middleware';
import { authMiddleware } from '../identidad/autenticacion/auth.middleware';
import {
    actualizarEstadoSchema,
    crearSolicitudSchema,
    listarSolicitudesSchema,
    solicitudIdParamSchema,
} from './cotizacion.dto';
import { CotizacionController } from './cotizacion.controller';

/**
 * Router público de cotización, montado en `/api/cotizacion`.
 *
 * **No lleva `authMiddleware`, y es intencionado**: la cotización es la
 * primera puerta comercial y se abre sin sesión. La contrapartida es el
 * limitador estricto —es el único endpoint público que escribe en la base—,
 * y el servicio no devuelve nada que no sea el propio identificador y la
 * estimación que el cliente ya vio.
 */
export const buildCotizacionRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(CotizacionController);

    router.use(cotizacionRateLimiter);

    router.post('/', validate(crearSolicitudSchema), asyncHandler(ctrl.crear));

    return router;
};

/**
 * Router del panel de cotizaciones, montado en `/api/cotizaciones`.
 *
 * Cualquier administrador autenticado gestiona el ciclo comercial; no exige
 * root porque atender solicitudes es el trabajo normal del despacho, igual
 * que los reportes.
 */
export const buildCotizacionesRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(CotizacionController);

    router.use(adminRateLimiter, authMiddleware);

    router.get('/', validate(listarSolicitudesSchema, 'query'), asyncHandler(ctrl.listar));
    router.get('/:id', validate(solicitudIdParamSchema, 'params'), asyncHandler(ctrl.obtener));
    router.get('/:id/documento', validate(solicitudIdParamSchema, 'params'), asyncHandler(ctrl.documento));
    router.patch(
        '/:id/estado',
        validate(solicitudIdParamSchema, 'params'),
        validate(actualizarEstadoSchema),
        asyncHandler(ctrl.cambiarEstado),
    );
    router.delete('/:id', validate(solicitudIdParamSchema, 'params'), asyncHandler(ctrl.eliminar));

    return router;
};
