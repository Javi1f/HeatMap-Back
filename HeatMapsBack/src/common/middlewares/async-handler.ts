import { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Adaptador que convierte un handler async en un `RequestHandler` válido
 * para Express, propagando cualquier rechazo de promesa al `next(err)` para
 * que llegue al `errorHandler` central.
 *
 * Reemplaza el patrón repetitivo de `try { ... } catch (err) { next(err) }`
 * en cada controlador.
 *
 * @example
 *   router.post('/login', asyncHandler(authController.login));
 */
export const asyncHandler = (
    handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler => {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
};
