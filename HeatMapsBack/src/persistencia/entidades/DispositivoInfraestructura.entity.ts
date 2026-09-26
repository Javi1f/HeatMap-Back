import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Por qué un dispositivo se trata como infraestructura y no como ocupante. */
export type MotivoInfraestructura = 'punto-de-acceso' | 'junto-a-nodo' | 'manual';

/**
 * Dispositivo que se detectó como infraestructura y no cuenta como ocupante:
 * un punto de acceso, el equipamiento pegado a un nodo o algo que un
 * administrador excluyó a mano.
 *
 * La clasificación se guarda por dispositivo y no por captura porque sólo puede
 * hacerse al ingerir, con la MAC en claro: después, en los hashes, el parentesco
 * entre BSSID de un mismo aparato ya no se ve.
 *
 * Como `captura`, **nunca almacena la MAC en claro**.
 */
@Entity('dispositivo_infraestructura')
@Index('idx_dispositivo_infraestructura_ultima', ['ultimaDeteccion'])
export class DispositivoInfraestructura {
    /** HMAC-SHA256 de la MAC, el mismo que usa `captura`. */
    @PrimaryColumn({ name: 'mac_hash', type: 'char', length: 64 })
    macHash: string;

    /** Regla que lo identificó. */
    @Column({ name: 'motivo', type: 'enum', enum: ['punto-de-acceso', 'junto-a-nodo', 'manual'] })
    motivo: MotivoInfraestructura;

    /**
     * Inicio de la racha actual de confirmaciones.
     *
     * Conserva el nombre de la columna, pero no es la primera vez que se vio:
     * se reinicia cuando el dispositivo pasa un rato sin volver a cumplir la
     * regla. Así `ultimaDeteccion − primeraDeteccion` mide cuánto lleva
     * cumpliéndola seguido, que es lo que distingue el equipamiento pegado a un
     * nodo de alguien que pasó a su lado (ver `InfraestructuraRepository`).
     */
    @Column({ name: 'primera_deteccion', type: 'datetime' })
    primeraDeteccion: Date;

    /**
     * Última vez que la regla lo volvió a confirmar.
     *
     * Las marcas automáticas caducan si dejan de confirmarse: un teléfono que
     * alguien dejó un rato junto a un nodo no debe quedar excluido para siempre.
     */
    @Column({ name: 'ultima_deteccion', type: 'datetime' })
    ultimaDeteccion: Date;
}
