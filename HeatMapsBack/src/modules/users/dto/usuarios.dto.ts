import { z } from 'zod';

/** Parámetro `:id` de un administrador. */
export const adminIdParamSchema = z.object({
    id: z.coerce.number().int().positive('id debe ser un entero positivo'),
});

/** Cuerpo de `PATCH /api/users/admins/:id/rol`. */
export const cambiarRolSchema = z.object({
    rol: z.enum(['root', 'admin']),
});

/** Cuerpo de `PATCH /api/users/admins/:id/activo`. */
export const cambiarActivoSchema = z.object({
    activo: z.boolean(),
});

/** Consulta de `GET /api/users/auditoria`. */
export const auditoriaQuerySchema = z.object({
    limite: z.coerce.number().int().min(1).max(500).default(100),
});

/** Parámetro `:id` de un administrador. */
export type AdminIdParam = z.infer<typeof adminIdParamSchema>;

/** Cuerpo del cambio de rol. */
export type CambiarRolDto = z.infer<typeof cambiarRolSchema>;

/** Cuerpo del cambio de activación. */
export type CambiarActivoDto = z.infer<typeof cambiarActivoSchema>;

/** Consulta de la auditoría. */
export type AuditoriaQuery = z.infer<typeof auditoriaQuerySchema>;
