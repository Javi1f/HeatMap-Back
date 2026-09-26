import { BeforeInsert, Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';
import { COLUMNA_UUID, nuevoUuid } from './uuid';

/**
 * Espacio monitorizado (auditorio, sala de estudio, plazoleta).
 *
 * Es la unidad sobre la que se agrega la ocupación: los sensores pertenecen a
 * una zona, y las métricas del dashboard se calculan por zona, nunca por
 * sensor individual.
 *
 * `capacidadMax` es opcional porque no todos los espacios tienen un aforo
 * declarado; cuando falta, el nivel de ocupación se deriva de umbrales
 * absolutos en lugar de un porcentaje (ver `OccupancyAggregatorService`).
 */
@Entity('zona')
@Unique('uq_zona_nombre', ['nombre'])
export class Zona {
    /** Identificador de la zona. */
    @PrimaryColumn({ name: 'id_zona', ...COLUMNA_UUID })
    idZona: string;

    /** Nombre legible del espacio, único. */
    @Column({ name: 'nombre', type: 'varchar', length: 100 })
    nombre: string;

    /** Descripcion libre del espacio para el panel de administracion. */
    @Column({ name: 'descripcion', type: 'text', nullable: true })
    descripcion: string | null;

    /** Aforo declarado del espacio. `null` si la institución no lo ha fijado. */
    @Column({ name: 'capacidad_max', type: 'int', unsigned: true, nullable: true })
    capacidadMax: number | null;

    /**
     * Geometría del espacio, en metros.
     *
     * Para una plazoleta rectangular basta con `{ ancho, alto }`, con el origen
     * en la esquina inferior izquierda. Se guarda como JSON y no en columnas
     * propias porque no toda zona es rectangular: un auditorio en L necesitaría
     * un polígono, y el esquema no tendría que cambiar para admitirlo.
     *
     * `null` mientras nadie haya medido el espacio; sin geometría no se puede
     * dibujar el mapa de calor.
     */
    @Column({ name: 'coordenadas', type: 'json', nullable: true })
    coordenadas: Record<string, unknown> | null;

    /** `false` retira la zona de las metricas sin borrar su historico. */
    @Column({ name: 'activa', type: 'boolean', default: true })
    activa: boolean;

    /** Alta de la zona en el sistema. */
    @CreateDateColumn({ name: 'fecha_creacion', type: 'datetime', precision: 6 })
    fechaCreacion: Date;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.idZona ??= nuevoUuid();
    }
}
