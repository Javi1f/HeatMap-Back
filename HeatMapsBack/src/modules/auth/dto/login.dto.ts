import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Esquema de validación de `POST /api/auth/login`.
 *
 * `username` puede ser el username real o el email; el servicio decide.
 */
export const loginSchema = z.object({
    username: z.string().trim().min(1, 'username es requerido'),
    password: z.string().min(1, 'password es requerido'),
});

/** Cuerpo validado de `POST /api/auth/login`. */
export type LoginDto = InferDto<typeof loginSchema>;
