import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { container } from 'tsyringe';
import { AppError, ErrorCode } from '../errors';
import { ApiErrorResponse } from '../types/api-response';
import { LoggerService } from '../logger/logger.service';

/**
 * Mapea un {@link AppError} (o subclase) a la forma de respuesta uniforme.
 */
const fromAppError = (err: AppError): ApiErrorResponse => ({
    success: false,
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    ...(err.details ? { details: err.details } : {}),
});

/**
 * Mapea un {@link ZodError} a 400 con detalle de issues.
 */
const fromZodError = (err: ZodError): ApiErrorResponse => ({
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
});

/**
 * Mapea cualquier otro error desconocido a 500. En producción oculta el
 * mensaje original para no filtrar detalles internos.
 */
const fromUnknown = (err: unknown): ApiErrorResponse => {
    const isProd = process.env.NODE_ENV === 'production';
    const fallback = (err as Error)?.message ?? 'Error desconocido';
    return {
        success: false,
        message: isProd ? 'Error interno del servidor' : fallback,
        code: ErrorCode.INTERNAL,
        statusCode: 500,
    };
};

/**
 * Resuelve un `unknown` capturado a la forma {@link ApiErrorResponse}.
 *
 * Implementa un dispatch por tipo con complejidad ciclomática mínima
 * (cada rama delega en un helper).
 */
const toErrorResponse = (err: unknown): ApiErrorResponse => {
    if (AppError.isAppError(err)) return fromAppError(err);
    if (err instanceof ZodError) return fromZodError(err);
    return fromUnknown(err);
};

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
export const errorHandler = (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
): void => {
    const logger = container.resolve(LoggerService);
    const requestId = req.requestId ?? 'no-req-id';
    const body = toErrorResponse(err);

    if (body.statusCode >= 500) {
        logger.error(`[${requestId}] ${body.code} ${body.statusCode}`, err);
    } else {
        logger.warn(`[${requestId}] ${body.code} ${body.statusCode}: ${body.message}`);
    }

    res.status(body.statusCode).json(body);
};

/**
 * Middleware para rutas no encontradas (404). Se monta DESPUÉS de todas
 * las rutas y ANTES del error handler.
 */
export const notFoundHandler = (req: Request, res: Response): void => {
    const body: ApiErrorResponse = {
        success: false,
        message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
        code: ErrorCode.NOT_FOUND,
        statusCode: 404,
    };
    res.status(404).json(body);
};
