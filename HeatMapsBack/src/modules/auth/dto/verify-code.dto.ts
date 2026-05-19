import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Esquema de validación de `POST /api/auth/verify-code`.
 *
 * El código es numérico de 5 dígitos (ver `generateNumericCode`).
 */
export const verifyCodeSchema = z.object({
    email: z.string().trim().toLowerCase().email('email inválido'),
    code: z
        .string()
        .trim()
        .regex(/^\d{5}$/, 'code debe ser una cadena de 5 dígitos'),
});

export type VerifyCodeDto = InferDto<typeof verifyCodeSchema>;
