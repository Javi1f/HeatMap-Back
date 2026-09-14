import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Captura } from '../../../models/Captura.entity';
import { Sensor } from '../../../models/Sensor.entity';
import { DatabaseConfig } from '../../../config/database.config';
import type { SenalPorNodo } from '../services/presencia';

/**
 * Fila lista para insertar en `captura`.
 *
 * Se declara aparte en lugar de usar `Partial<Captura>` porque el tipo de
 * inserción de TypeORM recorre también las relaciones, y una entidad con
 * relaciones anidadas no encaja en él. Además deja explícito qué campos hacen
 * falta de verdad para persistir una detección.
 */
export interface CapturaInsert {
    /** HMAC-SHA256 de la MAC detectada. */
    macHash: string;

    /** Nodo que realizo la deteccion. */
    idSensor: string;

    /** Potencia recibida en dBm. */
    rssi: number;

    /** Distancia estimada en metros, o `null` si el RSSI no era utilizable. */
    distanciaEstimada: number | null;

    /** Canal Wi-Fi en el que se vio la trama. */
    canal: number;

    /** Tipo de trama, recortado a la longitud de la columna. */
    tipoTrama: string;

    /** `true` si el bit U/L indica direccion administrada localmente. */
    esMacRandom: boolean;

    /** Momento en que el nodo vio la trama. */
    timestampCaptura: Date;
}

/**
 * Distancia media de un dispositivo a un nodo dentro de una ventana.
 *
 * Es la materia prima del mapa de calor: agrupando estas filas por `macHash` se
 * obtienen las distancias del mismo dispositivo a varios nodos, que es lo que
 * permite situarlo en el plano.
 */
export interface DistanciaPorNodo {
    /** Identificador anónimo del dispositivo. */
    macHash: string;

    /** Nodo que lo detectó. */
    idSensor: string;

    /** Posición del nodo en la zona, en metros. */
    posX: number;

    /** Posición del nodo en la zona, en metros. */
    posY: number;

    /** Media de las distancias estimadas en la ventana. */
    distancia: number;
}

/** Señal media de un dispositivo en un nodo, con la zona del nodo. */
export interface SenalEnZona extends SenalPorNodo {
    /** Zona a la que pertenece el nodo. */
    idZona: string;
}

/**
 * Acceso a las detecciones individuales.
 *
 * Es la tabla que más crece del sistema, así que la inserción es siempre en
 * lote: una lectura de un nodo con 60 dispositivos son 60 filas, y hacerlas
 * de una en una multiplicaría los round-trips a la base de datos.
 */
@injectable()
export class CapturaRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Captura>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Captura);
    }

    /**
     * Inserta un lote de detecciones.
     *
     * @returns Número de filas insertadas.
     */
    async insertMany(rows: CapturaInsert[]): Promise<number> {
        if (rows.length === 0) return 0;
        await this.repo.insert(rows);
        return rows.length;
    }

    /**
     * Distancias medias de cada dispositivo a cada nodo dentro de una ventana.
     *
     * Promedia por pareja dispositivo-nodo en lugar de tomar la última lectura:
     * el RSSI fluctúa varios dB entre tramas consecutivas sin que nadie se
     * mueva, y la media de la ventana es bastante más estable que cualquier
     * medida aislada.
     *
     * Solo devuelve nodos con posición conocida y detecciones con distancia
     * calculable; lo demás no puede entrar en el mapa.
     *
     * @param idZona - Zona cuyos nodos se consultan.
     * @param desde  - Inicio de la ventana, inclusivo.
     * @param hasta  - Fin de la ventana, inclusivo.
     */
    async distanciasPorNodo(idZona: string, desde: Date, hasta: Date): Promise<DistanciaPorNodo[]> {
        const filas = await this.repo
            .createQueryBuilder('c')
            .innerJoin(Sensor, 's', 's.idSensor = c.idSensor')
            .select('c.macHash', 'macHash')
            .addSelect('c.idSensor', 'idSensor')
            .addSelect('s.posX', 'posX')
            .addSelect('s.posY', 'posY')
            .addSelect('AVG(c.distanciaEstimada)', 'distancia')
            .where('s.idZona = :idZona', { idZona })
            .andWhere('c.timestampCaptura >= :desde AND c.timestampCaptura <= :hasta', { desde, hasta })
            .andWhere('c.distanciaEstimada IS NOT NULL')
            .andWhere('s.posX IS NOT NULL AND s.posY IS NOT NULL')
            .groupBy('c.macHash')
            .addGroupBy('c.idSensor')
            .addGroupBy('s.posX')
            .addGroupBy('s.posY')
            .getRawMany<{
                macHash: string;
                idSensor: string;
                posX: string;
                posY: string;
                distancia: string;
            }>();

        return filas.map((f) => ({
            macHash: f.macHash,
            idSensor: f.idSensor,
            posX: Number(f.posX),
            posY: Number(f.posY),
            distancia: Number(f.distancia),
        }));
    }

    /**
     * Señal media de cada dispositivo en cada nodo dentro de una ventana, que es
     * lo que necesita el criterio de presencia.
     *
     * Promedia el RSSI por pareja dispositivo-nodo por el mismo motivo que
     * {@link distanciasPorNodo}: una trama aislada fluctúa varios dB sin que
     * nadie se mueva.
     *
     * @param desde  - Inicio de la ventana, inclusivo.
     * @param hasta  - Fin de la ventana, exclusivo.
     * @param idZona - Limita la consulta a una zona; sin ella, todas.
     */
    async senalesPorNodo(desde: Date, hasta: Date, idZona?: string): Promise<SenalEnZona[]> {
        const consulta = this.repo
            .createQueryBuilder('c')
            .innerJoin(Sensor, 's', 's.idSensor = c.idSensor')
            .select('s.idZona', 'idZona')
            .addSelect('c.macHash', 'macHash')
            .addSelect('c.idSensor', 'idSensor')
            .addSelect('AVG(c.rssi)', 'rssi')
            .addSelect('MAX(c.esMacRandom)', 'esMacRandom')
            .where('c.timestampCaptura >= :desde AND c.timestampCaptura < :hasta', { desde, hasta });

        if (idZona) consulta.andWhere('s.idZona = :idZona', { idZona });

        const filas = await consulta
            .groupBy('s.idZona')
            .addGroupBy('c.macHash')
            .addGroupBy('c.idSensor')
            .getRawMany<{ idZona: string; macHash: string; idSensor: string; rssi: string; esMacRandom: string | number }>();

        return filas.map((f) => ({
            idZona: f.idZona,
            macHash: f.macHash,
            idSensor: f.idSensor,
            rssi: Number(f.rssi),
            esMacRandom: Number(f.esMacRandom) === 1,
        }));
    }

    /**
     * Tramas capturadas desde un momento, sin filtrar.
     *
     * Mide el trabajo de la red de nodos, no la ocupación: por eso cuenta
     * también lo que el criterio de presencia descarta.
     *
     * @param since - Momento a partir del cual contar.
     */
    async deteccionesDesde(since: Date): Promise<number> {
        return this.repo
            .createQueryBuilder('c')
            .where('c.timestampCaptura >= :since', { since })
            .getCount();
    }
}
