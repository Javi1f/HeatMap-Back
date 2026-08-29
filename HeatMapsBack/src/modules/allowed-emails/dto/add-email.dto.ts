import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Esquema de `POST /api/allowed-emails`.
 */
export const addAllowedEmailSchema = z.object({
    email: z.string().trim().toLowerCase().email('email inválido'),
});

/** Cuerpo validado de `POST /api/allowed-emails`. */
export type AddAllowedEmailDto = InferDto<typeof addAllowedEmailSchema>;

/**
 * Esquema de los params de `DELETE /api/allowed-emails/:id`.
 *
 * Convertimos el string del path a number.
 */
export const allowedEmailIdParamSchema = z.object({
    id: z.coerce.number().int().positive('id debe ser un entero positivo'),
});

/** Parametro de ruta validado de `DELETE /api/allowed-emails/:id`. */
export type AllowedEmailIdParam = InferDto<typeof allowedEmailIdParamSchema>;
