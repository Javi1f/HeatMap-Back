import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Captura } from '../../../models/Captura.entity';
import { Sensor } from '../../../models/Sensor.entity';
import { DatabaseConfig } from '../../../config/database.config';

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

/** Estadísticas de detecciones en una ventana reciente. */
export interface CapturaStats {
    /** MAC distintas vistas en la ventana. */
    dispositivosUnicos: number;
    /** Filas totales insertadas (una por dispositivo y lectura). */
    detecciones: number;
    /** Cuántas de las MAC distintas eran administradas localmente. */
    dispositivosRandomizados: number;
    /** `dispositivosRandomizados` sobre `dispositivosUnicos`, en porcentaje. */
    porcentajeRandomizadas: number;
    /** RSSI medio en dBm, o `null` si no hubo detecciones. */
    rssiPromedio: number | null;
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
     * Estadísticas de las detecciones recientes, para las tarjetas de estado
     * inmediato del dashboard.
     *
     * Se consulta sobre `captura` y no sobre la tabla agregada a propósito:
     * estos números describen «ahora mismo», y la ventana agregada más reciente
     * puede tener varios minutos de antigüedad.
     *
     * @param since - Momento a partir del cual contar.
     */
    async statsSince(since: Date): Promise<CapturaStats> {
        const row = await this.repo
            .createQueryBuilder('c')
            .select('COUNT(DISTINCT c.macHash)', 'dispositivosUnicos')
            .addSelect('COUNT(*)', 'detecciones')
            .addSelect(
                'COUNT(DISTINCT CASE WHEN c.esMacRandom = 1 THEN c.macHash END)',
                'dispositivosRandomizados',
            )
            .addSelect('AVG(c.rssi)', 'rssiPromedio')
            .where('c.timestampCaptura >= :since', { since })
            .getRawOne<{
                dispositivosUnicos: string;
                detecciones: string;
                dispositivosRandomizados: string;
                rssiPromedio: string | null;
            }>();

        const unicos = Number(row?.dispositivosUnicos ?? 0);
        const randomizados = Number(row?.dispositivosRandomizados ?? 0);

        return {
            dispositivosUnicos: unicos,
            detecciones: Number(row?.detecciones ?? 0),
            dispositivosRandomizados: randomizados,
            porcentajeRandomizadas: unicos === 0 ? 0 : Math.round((randomizados / unicos) * 1000) / 10,
            rssiPromedio:
                row?.rssiPromedio == null ? null : Math.round(Number(row.rssiPromedio) * 10) / 10,
        };
    }
}
