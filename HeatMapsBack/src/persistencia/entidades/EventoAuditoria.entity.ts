import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { COLUMNA_UUID } from './uuid';

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
@Index('idx_evento_auditoria_fecha', ['fecha'])
export class EventoAuditoria {
    /** Clave primaria. */
    @PrimaryGeneratedColumn({ name: 'id_evento', type: 'bigint', unsigned: true })
    idEvento: string;

    /** Momento del evento. */
    @CreateDateColumn({ name: 'fecha', type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' })
    fecha: Date;

    /**
     * Administrador que actuó, o `null` si no llegó a identificarse (login
     * fallido). No es clave foránea a propósito: la traza de auditoría tiene
     * que sobrevivir a la cuenta que la produjo.
     */
    @Column({ name: 'id_admin', ...COLUMNA_UUID, nullable: true })
    idAdmin: string | null;

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
