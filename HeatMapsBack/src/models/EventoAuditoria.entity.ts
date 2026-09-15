import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Acciones que quedan registradas en la auditoría. */
export type TipoEventoAuditoria =
    | 'inicio_sesion'
    | 'inicio_sesion_fallido'
    | 'cierre_sesion'
    | 'registro_completado'
    | 'sesion_revocada'
    | 'correo_permitido_agregado'
    | 'correo_permitido_eliminado'
    | 'rol_cambiado'
    | 'admin_activado'
    | 'admin_desactivado'
    | 'reporte_eliminado'
    | 'consumidor_iniciado'
    | 'consumidor_detenido';

/**
 * Evento de auditoría: quién hizo qué, cuándo y desde dónde.
 *
 * El detalle nunca lleva datos personales en claro —correos, nombres ni
 * contraseñas—, solo identificadores internos: la auditoría se consulta desde
 * el panel y no debe convertirse en otra copia de la información protegida.
 */
@Entity('evento_auditoria')
export class EventoAuditoria {
    /** Clave primaria. */
    @PrimaryGeneratedColumn({ name: 'id_evento', type: 'bigint' })
    idEvento: string;

    /** Momento del evento. */
    @Index()
    @CreateDateColumn({ name: 'fecha', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
    fecha: Date;

    /** Administrador que actuó, o `null` si no llegó a identificarse (login fallido). */
    @Column({ name: 'id_admin', type: 'int', unsigned: true, nullable: true })
    idAdmin: number | null;

    /** Acción realizada. */
    @Column({ name: 'tipo', type: 'varchar', length: 40 })
    tipo: TipoEventoAuditoria;

    /** Contexto sin datos personales, como el identificador del recurso afectado. */
    @Column({ name: 'detalle', type: 'varchar', length: 255, nullable: true })
    detalle: string | null;

    /** IP de origen de la petición. */
    @Column({ name: 'ip_origen', type: 'varchar', length: 45, nullable: true })
    ipOrigen: string | null;
}
