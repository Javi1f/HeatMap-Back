import { z } from 'zod';
import { InferDto } from '../../../common/middlewares/validate.middleware';

/**
 * Clases de reporte que el sistema sabe generar.
 *
 * Cada una responde a una pregunta distinta sobre el mismo histórico:
 *  - `serie_temporal`: cómo evolucionó la ocupación ventana a ventana.
 *  - `resumen_por_zona`: qué espacios se usaron más en el periodo.
 *  - `alertas`: qué aglomeraciones se detectaron y si se resolvieron.
 */
export const TIPOS_REPORTE = ['serie_temporal', 'resumen_por_zona', 'alertas'] as const;

/** Clase de reporte solicitada. */
export type TipoReporte = (typeof TIPOS_REPORTE)[number];

/**
 * Esquema de `POST /api/reportes`.
 *
 * El rango llega en ISO 8601 y se convierte a `Date` aquí, de modo que el
 * servicio no vuelve a validar fechas: si el esquema pasó, el rango es
 * coherente.
 */
export const crearReporteSchema = z
    .object({
        tipoReporte: z.enum(TIPOS_REPORTE),
        rangoInicio: z.coerce.date(),
        rangoFin: z.coerce.date(),
        /** Zona a la que se acota. Omitida, el reporte abarca todas. */
        idZona: z.string().trim().min(1).max(36).optional(),
    })
    .refine((d) => d.rangoFin > d.rangoInicio, {
        message: 'rangoFin debe ser posterior a rangoInicio',
        path: ['rangoFin'],
    });

/** Cuerpo validado de `POST /api/reportes`. */
export type CrearReporteDto = InferDto<typeof crearReporteSchema>;

/**
 * Esquema de los params de las rutas con `:id`.
 *
 * El identificador es un UUID; se valida como tal para que un valor mal
 * formado responda 400 en lugar de llegar a la base de datos.
 */
export const reporteIdParamSchema = z.object({
    id: z.string().uuid('id debe ser un UUID'),
});

/** Parámetro de ruta validado de las operaciones sobre un reporte. */
export type ReporteIdParam = InferDto<typeof reporteIdParamSchema>;
