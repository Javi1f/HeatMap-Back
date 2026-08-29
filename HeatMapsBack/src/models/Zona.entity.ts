import {
    Column,
    CreateDateColumn,
    Entity,
    PrimaryGeneratedColumn,
} from 'typeorm';

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
export class Zona {
    /** Identificador de la zona. */
    @PrimaryGeneratedColumn('uuid', { name: 'id_zona' })
    idZona: string;

    /**
     * Nombre del espacio, único para que el admin no cree duplicados.
     *
     * La unicidad se declara solo en `@Column`. Añadir además `@Index({ unique:
     * true })` haría que TypeORM emitiera dos veces el mismo índice y la
     * sincronización fallara con «Duplicate key name».
     */
    @Column({ name: 'nombre', length: 100, unique: true })
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
    @Column({ name: 'activa', default: true })
    activa: boolean;

    /** Alta de la zona en el sistema. */
    @CreateDateColumn({ name: 'fecha_creacion' })
    fechaCreacion: Date;
}
