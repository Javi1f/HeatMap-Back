import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Sensor } from './Sensor.entity';
import { decimalTransformer } from './numeric.transformer';

/**
 * Detección individual de un dispositivo por un nodo de captura.
 *
 * Es la tabla de mayor cardinalidad del sistema: una fila por dispositivo y
 * lectura. De ahí los índices compuestos por `(idSensor, timestampCaptura)` y
 * `(macHash, timestampCaptura)`, que son los dos accesos que hace la
 * agregación.
 *
 * **Nunca almacena la MAC en claro**: solo `macHash`, el HMAC-SHA256 de la
 * dirección. Ver `MacAnonymizerService` para el porqué del HMAC frente a un
 * hash desnudo.
 */
@Entity('captura')
export class Captura {
    /**
     * Clave primaria. Es `bigint` y se maneja como string en JS porque el
     * volumen esperado desborda el entero seguro de JavaScript.
     */
    @PrimaryGeneratedColumn({ name: 'id_captura', type: 'bigint' })
    idCaptura: string;

    /** HMAC-SHA256 de la MAC. 64 caracteres hex. */
    @Index()
    @Column({ name: 'mac_hash', length: 64 })
    macHash: string;

    /** Nodo que realizo la deteccion. */
    @Index()
    @Column({ name: 'id_sensor', length: 50 })
    idSensor: string;

    /** Nodo asociado. Dar de baja un nodo retira tambien sus detecciones. */
    @ManyToOne(() => Sensor, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'id_sensor' })
    sensor: Sensor;

    /** Potencia recibida en dBm. Siempre negativa en la practica. */
    @Column({ name: 'rssi', type: 'smallint' })
    rssi: number;

    /**
     * Distancia en metros estimada desde el RSSI con el modelo de pérdida de
     * propagación logarítmica. `null` si el RSSI no es utilizable.
     */
    @Column({ name: 'distancia_estimada', type: 'decimal',
        precision: 5,
        scale: 2,
        nullable: true,
        transformer: decimalTransformer,
    })
    distanciaEstimada: number | null;

    /** Canal Wi-Fi de la trama: 1-14 en 2,4 GHz y 36-165 en 5 GHz. */
    @Column({ name: 'canal', type: 'smallint', unsigned: true })
    canal: number;

    /** Tipo de trama capturada (`probe`, `data`, `beacon`...). */
    @Column({ name: 'tipo_trama', length: 20 })
    tipoTrama: string;

    /** `true` si el bit U/L del primer octeto indica MAC administrada localmente. */
    @Column({ name: 'es_mac_random', default: false })
    esMacRandom: boolean;

    /** Momento en que el nodo vio la trama, con precision de milisegundo. */
    @Index()
    @Column({ name: 'timestamp_captura', type: 'datetime', precision: 3 })
    timestampCaptura: Date;

    /**
     * Momento en que el backend la persistió. Comparada con
     * `timestampCaptura` da la latencia real del canal Kafka, de ahí que
     * conserve la precisión de milisegundos.
     *
     * El valor por defecto se escribe a mano porque MySQL exige que coincida
     * con la precisión de la columna: para `datetime(3)` acepta
     * `CURRENT_TIMESTAMP(3)` y rechaza `CURRENT_TIMESTAMP` a secas, que es lo
     * que TypeORM genera por su cuenta.
     */
    @CreateDateColumn({
        name: 'fecha_ingesta',
        type: 'datetime',
        precision: 3,
        default: () => 'CURRENT_TIMESTAMP(3)',
    })
    fechaIngesta: Date;
}
