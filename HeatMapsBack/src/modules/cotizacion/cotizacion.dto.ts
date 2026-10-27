import { z } from 'zod';
import { InferDto } from '../../common/middlewares/validate.middleware';
import { ESTADOS_SOLICITUD, EstadoSolicitud } from '../../persistencia/entidades/SolicitudCotizacion.entity';
import { TIPOS_RECINTO, TipoRecinto } from './estimacion';

/**
 * Esquema de `POST /api/cotizacion`.
 *
 * Llega del formulario público, cifrado de extremo a extremo por el
 * middleware de `/api`. Las reglas replican las del formulario para que un
 * error se descubra donde se puede corregir, pero la autoridad es esta:
 * si el esquema no pasa, no llega a la base.
 */
export const crearSolicitudSchema = z
    .object({
        tipoRecinto: z.enum(TIPOS_RECINTO),
        organizacion: z.string().trim().min(2).max(120),
        nombreContacto: z.string().trim().min(2).max(120),
        correoContacto: z.string().trim().email().max(254),
        telefonoContacto: z.string().trim().max(40).optional(),
        areaM2: z.coerce.number().int().min(10, 'El área mínima es 10 m²').max(1_000_000),
        aforoMinimo: z.coerce.number().int().min(1).max(500_000),
        aforoMaximo: z.coerce.number().int().min(1).max(500_000),
        eventosAnuales: z.coerce.number().int().min(1).max(2_000),
        requisitos: z.object({
            camaras: z.boolean(),
            analisisRed: z.boolean(),
            seguridadPrivada: z.boolean(),
            ventilacionRemota: z.boolean(),
            notas: z.string().trim().max(1_000).optional(),
        }),
        /** Autorización del tratamiento de datos (art. 9, Ley 1581 de 2012). */
        aceptaDatos: z.literal(true),
    })
    .refine((datos) => datos.aforoMaximo >= datos.aforoMinimo, {
        message: 'El aforo máximo debe ser mayor o igual al mínimo',
        path: ['aforoMaximo'],
    });

/** Cuerpo validado de `POST /api/cotizacion`. */
export type CrearSolicitudDto = InferDto<typeof crearSolicitudSchema>;

/** Esquema de los params de las rutas con `:id`. */
export const solicitudIdParamSchema = z.object({
    id: z.string().uuid('id debe ser un UUID'),
});

/** Parámetro de ruta de las operaciones sobre una solicitud. */
export type SolicitudIdParam = InferDto<typeof solicitudIdParamSchema>;

/**
 * Esquema de `PATCH /api/cotizaciones/:id/estado`.
 *
 * El equipo comercial mueve la solicitud por su ciclo; las notas viajan
 * juntas porque un cambio de estado sin contexto pierde la mitad del valor.
 */
export const actualizarEstadoSchema = z.object({
    estado: z.enum(ESTADOS_SOLICITUD),
    notas: z.string().trim().max(2_000).optional(),
});

/** Cuerpo validado de `PATCH /api/cotizaciones/:id/estado`. */
export type ActualizarEstadoDto = InferDto<typeof actualizarEstadoSchema>;

/** Estados que el filtro del listado acepta en la consulta. */
export const listarSolicitudesSchema = z.object({
    estado: z.enum(ESTADOS_SOLICITUD).optional(),
});

/** Consulta validada del listado. */
export type ListarSolicitudesConsulta = InferDto<typeof listarSolicitudesSchema>;

/** Tipo reutilizable del estado de una solicitud. */
export type { EstadoSolicitud, TipoRecinto };
