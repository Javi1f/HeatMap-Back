import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Esquema de `POST /api/auth/cancel-verification`.
 */
export const cancelVerificationSchema = z.object({
    email: z.string().trim().toLowerCase().email('email inválido'),
});

/** Cuerpo validado de `POST /api/auth/cancel-verification`. */
export type CancelVerificationDto = InferDto<typeof cancelVerificationSchema>;
