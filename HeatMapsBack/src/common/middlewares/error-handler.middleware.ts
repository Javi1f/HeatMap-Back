import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { container } from 'tsyringe';
import { AppError, ErrorCode } from '../errors';
import { ApiErrorResponse } from '../types/api-response';
import { LoggerService } from '../logger/logger.service';

/**
 * Middleware central de manejo de errores.
 *
 * Atrapa cualquier error que llegue al pipeline de Express y lo transforma
 * en una {@link ApiErrorResponse} con la forma uniforme:
 *
 *     { success: false, message, code, statusCode, details? }
 *
 * Mapea:
 *  - {@link AppError} y subclases → usa su `statusCode`, `code`, `details`.
 *  - {@link ZodError}             → 400 con campo `details.issues`.
 *  - Cualquier otro error         → 500 genérico, mensaje oculto en producción.
 *
 * IMPORTANTE: Express identifica el error handler por su firma de 4 parámetros.
 * Aunque `_next` no se use, debe declararse.
 */
export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
): void {
    const logger = container.resolve(LoggerService);
    const requestId = req.requestId ?? 'no-req-id';

    let body: ApiErrorResponse;

    if (AppError.isAppError(err)) {
        body = {
            success: false,
            message: err.message,
            code: err.code,
            statusCode: err.statusCode,
            ...(err.details ? { details: err.details } : {}),
        };
        logger.warn(`[${requestId}] ${err.code} ${err.statusCode}: ${err.message}`);
    } else if (err instanceof ZodError) {
        body = {
            success: false,
            message: 'Payload inválido',
            code: ErrorCode.VALIDATION_FAILED,
            statusCode: 400,
            details: {
                issues: err.issues.map((i) => ({
                    path: i.path.join('.'),
                    message: i.message,
                })),
            },
        };
        logger.warn(`[${requestId}] VALIDATION_FAILED 400`);
    } else {
        const isProd = process.env.NODE_ENV === 'production';
        body = {
            success: false,
            message: isProd ? 'Error interno del servidor' : (err as Error)?.message ?? 'Error desconocido',
            code: ErrorCode.INTERNAL,
            statusCode: 500,
        };
        logger.error(`[${requestId}] INTERNAL 500`, err);
    }

    res.status(body.statusCode).json(body);
}

/**
 * Middleware para rutas no encontradas (404). Se monta DESPUÉS de todas
 * las rutas y ANTES del error handler.
 */
export function notFoundHandler(req: Request, res: Response): void {
    const body: ApiErrorResponse = {
        success: false,
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
        code: ErrorCode.NOT_FOUND,
        statusCode: 404,
    };
    res.status(404).json(body);
}
