import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Zona } from './Zona.entity';
import { decimalTransformer } from './numeric.transformer';

/** Nivel de ocupación derivado del conteo frente al aforo de la zona. */
export type NivelOcupacion = 'baja' | 'media' | 'alta';

/**
 * Ocupación de una zona consolidada en una ventana temporal cerrada.
 *
 * Es la tabla que alimenta el dashboard: consultar `captura` directamente para
 * pintar una serie de varias horas obligaría a un `COUNT(DISTINCT)` sobre
 * millones de filas en cada carga. Aquí ese cálculo ya está hecho, una vez por
 * ventana.
 *
 * La distinción entre `dispositivosUnicos` y `dispositivosEstables` es la
 * concesión a la aleatorización de MAC: un mismo teléfono puede aparecer como
 * varios dispositivos únicos dentro de la misma ventana, mientras que los
 * estables (MAC de fabricante) no se duplican. El primero sobreestima, el
 * segundo subestima, y el conteo real queda entre ambos.
 */
@Entity('ocupacion_agregada')
@Index(['idZona', 'intervaloInicio'])
export class OcupacionAgregada {
    /** Clave primaria, `bigint` por el mismo motivo que en `Captura`. */
    @PrimaryGeneratedColumn({ name: 'id_ocupacion', type: 'bigint' })
    idOcupacion: string;

    /** Zona consolidada. */
    @Column({ name: 'id_zona', length: 36 })
    idZona: string;

    /** Zona asociada. Al borrarla se lleva su historico de ocupacion. */
    @ManyToOne(() => Zona, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'id_zona' })
    zona: Zona;

    /** Inicio de la ventana, inclusivo. Alineado a multiplos de su duracion. */
    @Column({ name: 'intervalo_inicio', type: 'datetime' })
    intervaloInicio: Date;

    /** Fin de la ventana, exclusivo. */
    @Column({ name: 'intervalo_fin', type: 'datetime' })
    intervaloFin: Date;

    /** MACs distintas vistas en la ventana, aleatorizadas incluidas. */
    @Column({ name: 'dispositivos_unicos', type: 'int', unsigned: true, default: 0 })
    dispositivosUnicos: number;

    /** Subconjunto de las anteriores cuya MAC es de fabricante. */
    @Column({ name: 'dispositivos_estables', type: 'int', unsigned: true, default: 0 })
    dispositivosEstables: number;

    /** RSSI medio de las detecciones de la ventana, en dBm. */
    @Column({ name: 'rssi_promedio', type: 'decimal',
        precision: 5,
        scale: 2,
        nullable: true,
        transformer: decimalTransformer,
    })
    rssiPromedio: number | null;

    /** Nivel derivado del conteo frente al aforo. Indexado para los filtros. */
    @Index()
    @Column({ name: 'nivel_ocupacion', type: 'enum', enum: ['baja', 'media', 'alta'], default: 'baja' })
    nivelOcupacion: NivelOcupacion;
}
