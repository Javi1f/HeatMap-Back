import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Esquema de validación de `POST /api/auth/register`.
 *
 * Restricciones:
 *  - `username`: 3-32 caracteres alfanuméricos, guion bajo y guion.
 *  - `email`:    formato RFC válido, normalizado a minúsculas.
 *  - `password`: mínimo 8 caracteres.
 */
export const registerSchema = z.object({
    username: z
        .string()
        .trim()
        .min(3, 'username debe tener al menos 3 caracteres')
        .max(32, 'username no puede exceder 32 caracteres')
        .regex(/^[A-Za-z0-9_-]+$/, 'username solo admite letras, números, guion bajo y guion'),
    email: z.string().trim().toLowerCase().email('email inválido'),
    password: z.string().min(8, 'password debe tener al menos 8 caracteres'),
});

export type RegisterDto = InferDto<typeof registerSchema>;
