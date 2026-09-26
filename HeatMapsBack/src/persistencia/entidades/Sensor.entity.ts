import {
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
import { decimalTransformer } from './numeric.transformer';
import { COLUMNA_UUID } from './uuid';

/** Estado operativo de un nodo de captura. */
export type EstadoSensor = 'activo' | 'inactivo' | 'mantenimiento';

/**
 * Nodo de captura desplegado: el conjunto del computador de placa reducida y
 * su tarjeta inalámbrica en modo monitor.
 *
 * La clave primaria es el `sensor_id` que el propio nodo publica en Kafka, no
 * un autonumérico: así el mensaje entrante identifica su origen sin necesidad
 * de un registro previo por parte de un administrador.
 *
 * `ultimaConexion` se actualiza en cada lectura recibida y es lo que permite
 * distinguir un nodo vivo de uno caído sin necesidad de heartbeat aparte.
 */
@Entity('sensor')
@Index('idx_sensor_zona', ['idZona'])
@Index('idx_sensor_estado', ['estado'])
@Index('idx_sensor_registrado_por', ['registradoPor'])
export class Sensor {
    /** Identificador que el propio nodo publica en cada mensaje de Kafka. */
    @PrimaryColumn({ name: 'id_sensor', type: 'varchar', length: 50 })
    idSensor: string;

    /** Nombre legible. Al auto-registrarse toma el valor de `idSensor`. */
    @Column({ name: 'nombre', type: 'varchar', length: 100 })
    nombre: string;

    /** Zona a la que pertenece el nodo. */
    @Column({ name: 'id_zona', ...COLUMNA_UUID })
    idZona: string;

    /**
     * Zona asociada. `RESTRICT` impide borrar una zona que aun tenga nodos
     * desplegados, que dejaria capturas huerfanas.
     */
    @ManyToOne(() => Zona, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'id_zona', foreignKeyConstraintName: 'fk_sensor_zona' })
    zona: Zona;

    /** Estado operativo declarado por el administrador. */
    @Column({ name: 'estado', type: 'enum', enum: ['activo', 'inactivo', 'mantenimiento'], default: 'activo' })
    estado: EstadoSensor;

    /**
     * IP del nodo en la red local, para diagnóstico en sitio.
     *
     * El tipo de columna se declara explícitamente porque TypeORM no puede
     * inferirlo de una unión `string | null`: los metadatos de diseño la
     * reducen a `Object` y el driver de MySQL la rechaza al arrancar.
     */
    @Column({ name: 'ip_local', type: 'varchar', length: 45, nullable: true })
    ipLocal: string | null;

    /** Momento de la última lectura recibida por Kafka. */
    @Column({ name: 'ultima_conexion', type: 'datetime', nullable: true })
    ultimaConexion: Date | null;

    /** Momento en que el nodo aparecio por primera vez. */
    @CreateDateColumn({ name: 'fecha_registro', type: 'datetime', precision: 6 })
    fechaRegistro: Date;

    /**
     * Administrador que dio de alta el nodo.
     *
     * `null` en los que se auto-registran al publicar su primera lectura, que
     * es el caso habitual: el nodo aparece antes de que nadie lo declare.
     */
    @Column({ name: 'registrado_por', ...COLUMNA_UUID, nullable: true })
    registradoPor: string | null;

    /** Administrador asociado. Si se borra la cuenta, el nodo queda sin autor. */
    @ManyToOne(() => Admin, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'registrado_por', foreignKeyConstraintName: 'fk_sensor_registrado_por' })
    registrador: Admin | null;

    /**
     * Metros desde el borde izquierdo de la zona.
     *
     * Junto con `posY` sitúa el nodo en el plano, que es lo que permite
     * convertir distancias estimadas en posiciones. `null` mientras un
     * administrador no lo haya medido: un nodo recién auto-registrado no sabe
     * dónde está, y sin posición queda fuera del mapa de calor aunque siga
     * contando para la ocupación.
     */
    @Column({
        name: 'pos_x',
        type: 'decimal',
        precision: 6,
        scale: 2,
        nullable: true,
        comment: 'Metros desde el borde izquierdo de la zona',
        transformer: decimalTransformer,
    })
    posX: number | null;

    /** Metros desde el borde inferior de la zona. Ver {@link posX}. */
    @Column({
        name: 'pos_y',
        type: 'decimal',
        precision: 6,
        scale: 2,
        nullable: true,
        comment: 'Metros desde el borde inferior de la zona',
        transformer: decimalTransformer,
    })
    posY: number | null;
}
