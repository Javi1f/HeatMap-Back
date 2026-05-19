import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { container } from 'tsyringe';
import { AppError, ErrorCode } from '../errors';
import { ApiErrorResponse } from '../types/api-response';
import { LoggerService } from '../logger/logger.service';

/**
 * Resuelve un `unknown` capturado a la forma `ApiErrorResponse`.
 *
 * Extraído del middleware principal para mantener su complejidad baja y
 * permitir testearlo de forma aislada en el futuro.
 *
 * @param err - Error original capturado por Express.
 * @returns Cuerpo de respuesta listo para enviar al cliente.
 */
const toErrorResponse = (err: unknown): ApiErrorResponse => {
    if (AppError.isAppError(err)) {
        return {
            success: false,
            message: err.message,
            code: err.code,
            statusCode: err.statusCode,
            ...(err.details ? { details: err.details } : {}),
        };
    }
    if (err instanceof ZodError) {
        return {
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
    }
    const isProd = process.env.NODE_ENV === 'production';
    return {
        success: false,
        message: isProd
            ? 'Error interno del servidor'
            : (err as Error)?.message ?? 'Error desconocido',
        code: ErrorCode.INTERNAL,
        statusCode: 500,
    };
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
