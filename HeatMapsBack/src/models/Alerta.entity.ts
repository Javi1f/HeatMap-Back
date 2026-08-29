import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Zona } from './Zona.entity';

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
@Index(['idZona', 'timestampAlerta'])
export class Alerta {
    /** Identificador de la alerta. */
    @PrimaryGeneratedColumn('uuid', { name: 'id_alerta' })
    idAlerta: string;

    /** Zona en la que se detecto la aglomeracion. */
    @Column({ name: 'id_zona', length: 36 })
    idZona: string;

    /** Zona asociada. Al borrarla se llevan sus alertas por delante. */
    @ManyToOne(() => Zona, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'id_zona' })
    zona: Zona;

    /** Gravedad asignada al levantarla. */
    @Column({ name: 'nivel', type: 'enum', enum: ['advertencia', 'critica'] })
    nivel: NivelAlerta;

    /** Texto con el conteo y el aforo que motivaron la alerta. */
    @Column({ name: 'mensaje', type: 'text' })
    mensaje: string;

    /** Momento en que se levanto. */
    @CreateDateColumn({ name: 'timestamp_alerta' })
    timestampAlerta: Date;

    /** `false` mientras siga abierta. Indexado porque es el filtro habitual. */
    @Index()
    @Column({ name: 'resuelta', default: false })
    resuelta: boolean;

    /** Username del admin que la resolvió. `null` mientras siga abierta. */
    @Column({ name: 'resuelta_por', type: 'text', nullable: true })
    resueltaPor: string | null;
}
