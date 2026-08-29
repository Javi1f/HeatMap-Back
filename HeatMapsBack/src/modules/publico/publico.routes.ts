import { Router } from 'express';
import { container } from 'tsyringe';
import { asyncHandler } from '../../common/middlewares/async-handler';
import { publicRateLimiter } from '../../common/middlewares/rate-limit.middleware';
import { PublicoController } from './publico.controller';

/**
 * Router de la vista pública, montado en `/api/publico`.
 *
 * **No lleva `authMiddleware`, y es intencionado.** Todo lo que cuelga de aquí
 * es legible por cualquiera que conozca la URL. Antes de añadir una ruta a este
 * router, comprueba que su respuesta no contenga identificadores de
 * dispositivo, direcciones MAC —ni siquiera anonimizadas—, medidas por
 * dispositivo ni identificadores internos de infraestructura.
 */
export const buildPublicoRouter = (): Router => {
    const router = Router();
    const ctrl = container.resolve(PublicoController);

    router.use(publicRateLimiter);

    router.get('/zonas', asyncHandler(ctrl.zonas));
    router.get('/mapa', asyncHandler(ctrl.mapa));

    return router;
};
