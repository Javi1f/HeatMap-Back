import {
    BeforeInsert,
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
    UpdateDateColumn,
} from 'typeorm';
import { COLUMNA_UUID, nuevoUuid } from './uuid';
import type { TipoRecinto } from '../../modules/cotizacion/estimacion';

/** Estados del ciclo comercial de una solicitud, en orden de avance. */
export const ESTADOS_SOLICITUD = [
    'nueva',
    'en-revision',
    'contactada',
    'cerrada',
    'descartada',
] as const;

/** Estado en el ciclo comercial de una solicitud. */
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

/**
 * Solicitud de cotización que un visitante envía desde la web, sin sesión.
 *
 * Es la puerta de entrada comercial del sistema: describe su recinto, el
 * estimador responde con un alcance técnico preliminar y el equipo comercial
 * toma la fila para refinarla y contactar al posible cliente.
 *
 * Diseño de privacidad (mismo criterio que `admin.email`, RNF-13):
 *  - `correoContacto` se almacena **cifrado** con AES-256-GCM en una columna
 *    `text`; en claro no se persiste nunca. No lleva columna hash porque
 *    nunca se busca por correo: se lista y se abre.
 *  - `datos` guarda la solicitud tal cual llegó, **sin el correo**: el
 *    documento JSON conservado no duplica el dato que ya vive cifrado en
 *    su columna.
 *  - `estimacion` congela la estimación que se le mostró al cliente: si el
 *    estimador cambia después, la conversación comercial sigue partiendo
 *    de lo que el posible cliente vio.
 */
@Entity('solicitud_cotizacion')
@Index('idx_solicitud_cotizacion_estado', ['estado'])
@Index('idx_solicitud_cotizacion_fecha', ['fechaCreacion'])
@Check('chk_solicitud_cotizacion_aforo', '`aforo_maximo` >= `aforo_minimo`')
export class SolicitudCotizacion {
    /** Identificador de la solicitud. */
    @PrimaryColumn({ name: 'id_solicitud', ...COLUMNA_UUID })
    idSolicitud: string;

    /** Clase de recinto descrita por el cliente. */
    @Column({
        name: 'tipo_recinto',
        type: 'enum',
        enum: [
            'auditorio',
            'centro-convenciones',
            'universidad',
            'estadio',
            'centro-comercial',
            'plaza-publica',
            'otro',
        ],
    })
    tipoRecinto: TipoRecinto;

    /** Organización o empresa del posible cliente. */
    @Column({ name: 'organizacion', type: 'varchar', length: 120 })
    organizacion: string;

    /** Nombre de la persona de contacto. */
    @Column({ name: 'nombre_contacto', type: 'varchar', length: 120 })
    nombreContacto: string;

    /** Correo de contacto, cifrado con AES-256-GCM. */
    @Column({ name: 'correo_contacto', type: 'text' })
    correoContacto: string;

    /** Teléfono de contacto, opcional. */
    @Column({ name: 'telefono_contacto', type: 'varchar', length: 40, nullable: true })
    telefonoContacto: string | null;

    /** Área aproximada del recinto, en m². */
    @Column({ name: 'area_m2', type: 'int', unsigned: true })
    areaM2: number;

    /** Aforo mínimo esperado. */
    @Column({ name: 'aforo_minimo', type: 'int', unsigned: true })
    aforoMinimo: number;

    /** Aforo máximo esperado. */
    @Column({ name: 'aforo_maximo', type: 'int', unsigned: true })
    aforoMaximo: number;

    /** Eventos al año que aloja el recinto. */
    @Column({ name: 'eventos_anuales', type: 'int', unsigned: true })
    eventosAnuales: number;

    /** Solicitud tal como llegó (documento JSON, sin el correo). */
    @Column({ name: 'datos', type: 'json' })
    datos: Record<string, unknown>;

    /** Estimación congelada que se mostró al cliente. */
    @Column({ name: 'estimacion', type: 'json' })
    estimacion: Record<string, unknown>;

    /** Estado en el ciclo comercial. */
    @Column({
        name: 'estado',
        type: 'enum',
        enum: ESTADOS_SOLICITUD,
        default: 'nueva',
    })
    estado: EstadoSolicitud;

    /** Notas del equipo comercial: criterios, acuerdos, seguimiento. */
    @Column({ name: 'notas_comerciales', type: 'text', nullable: true })
    notasComerciales: string | null;

    /** IP desde la que llegó la solicitud, para el rastro antispam. */
    @Column({ name: 'ip_origen', type: 'varchar', length: 45, nullable: true })
    ipOrigen: string | null;

    /** Momento en que llegó la solicitud. */
    @CreateDateColumn({ name: 'fecha_creacion', type: 'datetime', precision: 6 })
    fechaCreacion: Date;

    /** Última modificación de la fila. */
    @UpdateDateColumn({ name: 'fecha_actualizacion', type: 'datetime', precision: 6 })
    fechaActualizacion: Date;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.idSolicitud ??= nuevoUuid();
    }
}
