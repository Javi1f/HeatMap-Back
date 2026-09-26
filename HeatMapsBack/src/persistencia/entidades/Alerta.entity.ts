import {
    BeforeInsert,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from 'typeorm';
import { Admin } from './Admin.entity';
import { Zona } from './Zona.entity';
import { COLUMNA_UUID, nuevoUuid } from './uuid';

/** Gravedad de una alerta de aglomeración. */
export type NivelAlerta = 'advertencia' | 'critica';

/**
 * Aviso de aglomeración generado automáticamente al cerrar una ventana de
 * agregación cuyo nivel de ocupación supera el umbral de la zona.
 *
 * El responsable institucional la marca como resuelta desde el panel; se
 * conserva la fila para poder contrastar después las alertas emitidas contra
 * los eventos realmente observados, que es uno de los mecanismos de validación
 * del proyecto.
 */
@Entity('alerta')
@Index('idx_alerta_zona_timestamp', ['idZona', 'timestampAlerta'])
@Index('idx_alerta_resuelta', ['resuelta'])
@Index('idx_alerta_resuelta_por', ['resueltaPor'])
export class Alerta {
    /** Identificador de la alerta. */
    @PrimaryColumn({ name: 'id_alerta', ...COLUMNA_UUID })
    idAlerta: string;

    /** Zona en la que se detectó la aglomeración. */
    @Column({ name: 'id_zona', ...COLUMNA_UUID })
    idZona: string;

    /** Zona asociada. Al borrarla se llevan sus alertas por delante. */
    @ManyToOne(() => Zona, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'id_zona', foreignKeyConstraintName: 'fk_alerta_zona' })
    zona: Zona;

    /** Gravedad asignada al levantarla. */
    @Column({ name: 'nivel', type: 'enum', enum: ['advertencia', 'critica'] })
    nivel: NivelAlerta;

    /** Texto con el conteo y el aforo que motivaron la alerta. */
    @Column({ name: 'mensaje', type: 'text' })
    mensaje: string;

    /** Momento en que se levanto. */
    @CreateDateColumn({ name: 'timestamp_alerta', type: 'datetime', precision: 6 })
    timestampAlerta: Date;

    /** `false` mientras siga abierta. Indexado porque es el filtro habitual. */
    @Column({ name: 'resuelta', type: 'boolean', default: false })
    resuelta: boolean;

    /** Administrador que la resolvió. `null` mientras siga abierta. */
    @Column({ name: 'resuelta_por', ...COLUMNA_UUID, nullable: true })
    resueltaPor: string | null;

    /** Administrador asociado. Si se borra la cuenta, el cierre queda sin autor. */
    @ManyToOne(() => Admin, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'resuelta_por', foreignKeyConstraintName: 'fk_alerta_resuelta_por' })
    resolutor: Admin | null;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.idAlerta ??= nuevoUuid();
    }
}
