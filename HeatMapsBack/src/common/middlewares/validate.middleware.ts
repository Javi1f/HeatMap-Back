import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodTypeAny, z } from 'zod';

/**
 * Origen de los datos a validar dentro de una petición HTTP.
 */
export type RequestPart = 'body' | 'query' | 'params';

/**
 * Crea un middleware de validación a partir de un esquema Zod.
 *
 * Reemplaza el patrón de validación manual dispersa en los controladores.
 * Tras la validación, **sustituye** el contenido por la versión parseada
 * (con coerciones, defaults y trims aplicados).
 *
 * Si la validación falla, lanza el {@link ZodError} para que el
 * `errorHandler` central lo formatee como `400 VALIDATION_FAILED`.
 *
 * @typeParam S - Esquema Zod del payload.
 * @param schema - Esquema Zod a aplicar.
 * @param part   - Parte de la petición a validar (default `body`).
 *
 * @example
 *   router.post('/login', validate(loginSchema), authController.login);
 *
 *   // Dentro del controller, req.body ya está tipado y validado:
 *   const { username, password } = req.body as LoginDto;
 */
export const validate = <S extends ZodTypeAny>(
    schema: S,
    part: RequestPart = 'body',
): RequestHandler => {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const parsed = schema.parse(req[part]);
        (req as unknown as Record<RequestPart, unknown>)[part] = parsed;
        next();
    };
};

/**
 * Helper de inferencia: dado un esquema Zod, obtén el tipo TS del DTO.
 *
 *     const loginSchema = z.object({ ... });
 *     type LoginDto = InferDto<typeof loginSchema>;
 */
export type InferDto<S extends ZodTypeAny> = z.infer<S>;
