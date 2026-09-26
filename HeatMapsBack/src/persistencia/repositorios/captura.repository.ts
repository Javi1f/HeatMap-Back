import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Captura } from '../entidades/Captura.entity';
import { DatabaseConfig } from '../../config/database.config';

/**
 * Unión que obliga a MySQL a recorrer primero `captura` y después `sensor`.
 *
 * Con un `JOIN` normal, el optimizador entraba por `sensor` —tres filas— y,
 * para cada nodo, recorría **todas** las capturas de su historia por el índice
 * de `id_sensor`, filtrando la fecha fila a fila. Con 4,8 millones de capturas,
 * la señal de una ventana de 15 minutos tardaba 27,8 s. Recorriendo primero
 * `captura` por el rango de fechas tarda 1,4 s.
 *
 * Se fuerza el orden y no un índice concreto porque los nombres de índice no
 * coinciden entre entornos: la base creada con `bd/database.sql` tiene los
 * compuestos del esquema y la creada por TypeORM, los simples que genera él.
 * Las dos tienen un índice sobre `timestamp_captura`, que es lo que hace falta.
 */
const ANTES_LAS_CAPTURAS = 'STRAIGHT_JOIN';

/**
 * Percentil de la señal de cada enlace con el que se sitúa un dispositivo
 * (ver `senalesDeNodosSituados`). Es el de índice `⌊0,75·(n − 1)⌋` de las
 * tramas ordenadas de menor a mayor.
 */
const PERCENTIL_POSICION = 0.75;

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
 * Señal media de un dispositivo en un nodo situado, dentro de una ventana.
 *
 * Es la materia prima del mapa de calor: agrupando estas filas por `macHash` se
 * obtienen las señales del mismo dispositivo en varios nodos, que es lo que
 * permite situarlo en el plano.
 */
export interface SenalDeNodoSituado {
    /** Identificador anónimo del dispositivo. */
    macHash: string;

    /** Nodo que lo detectó. */
    idSensor: string;

    /** Posición del nodo en la zona, en metros. */
    posX: number;

    /** Posición del nodo en la zona, en metros. */
    posY: number;

    /** Media del RSSI en la ventana, en dBm. */
    rssi: number;
}

/** Señal media de un dispositivo en un nodo, dentro de una ventana. */
export interface SenalPorNodo {
    /** Identificador anónimo del dispositivo. */
    macHash: string;

    /** Nodo que lo oyó. */
    idSensor: string;

    /** RSSI medio en ese nodo, en dBm. */
    rssi: number;

    /** `true` si la MAC es administrada localmente. */
    esMacRandom: boolean;
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
     * **Sin releer lo insertado.** `Repository.insert` de TypeORM, en MySQL,
     * lanza después un `SELECT` de todas las filas recién escritas para
     * rellenar en memoria las columnas que genera la base (`id_captura`,
     * `fecha_ingesta` y los valores por defecto). Aquí nadie usa esas
     * entidades, y la relectura triplicaba el coste: medido con una lectura
     * real de 770 dispositivos, 1.739 ms con relectura frente a 510 ms sin
     * ella. Con los nodos publicando unas 45 lecturas por minuto, esa
     * diferencia es la que separa un consumer que da abasto de uno que se
     * queda atrás para siempre.
     *
     * @returns Número de filas insertadas.
     */
    async insertMany(rows: CapturaInsert[]): Promise<number> {
        if (rows.length === 0) return 0;
        await this.repo
            .createQueryBuilder()
            .insert()
            .into(Captura)
            .values(rows)
            .updateEntity(false)
            .execute();
        return rows.length;
    }

    /**
     * Señal de cada dispositivo en cada nodo situado, **en sus últimas
     * lecturas** dentro de una ventana, para situarlo en el plano.
     *
     * **Sólo las últimas**: de cada dispositivo se toman las lecturas de los
     * `episodioS` segundos anteriores a la más reciente que haya de él. Promediar
     * toda la ventana mezcla posiciones: un teléfono que estaba junto a un nodo
     * y se movió al otro extremo daba una media que no corresponde a ningún
     * sitio. Medido con uno en un punto conocido, la ventana de 30 minutos lo
     * situaba a 6,5 m de donde estaba porque la mitad de sus lecturas eran de
     * veinte minutos antes, en otro lugar.
     *
     * Dentro de ese último tramo toma, por pareja dispositivo-nodo, el
     * **percentil 75** de la señal y no la media. Quien pasa entre el aparato y
     * el nodo le quita a las tramas de ese rato entre 5 y 15 dB, y nunca se las
     * suma: la media arrastra esa caída y el percentil alto la ignora mientras
     * afecte a menos de una cuarta parte de las tramas. Probado sobre medidas
     * reales con gente de paso simulada, el peor 10 % de los errores de posición
     * baja de 5,1 m a 4,9 m solo por esto, y combinado con el posicionador de
     * `PositioningService`, de 7,1 m a 4,9 m. Sin nadie alrededor da lo mismo
     * que la media, porque con el aparato quieto las tramas apenas varían.
     *
     * **Trabaja con la señal y no con la distancia**, aunque la distancia ya
     * esté guardada: la distancia crece exponencialmente al caer el RSSI, así
     * que cualquier estadístico de las distancias sale sesgado hacia arriba.
     *
     * Solo devuelve nodos con posición conocida; el resto no puede entrar en el
     * mapa.
     *
     * @param idZona    - Zona cuyos nodos se consultan.
     * @param desde     - Inicio de la ventana, inclusivo.
     * @param hasta     - Fin de la ventana, inclusivo.
     * @param episodioS - Segundos antes de su última lectura que se tienen en
     *                    cuenta de cada dispositivo.
     */
    async senalesDeNodosSituados(idZona: string, desde: Date, hasta: Date, episodioS: number): Promise<SenalDeNodoSituado[]> {
        const filas: { macHash: string; idSensor: string; posX: string; posY: string; rssi: string }[] = await this.repo.query(
            `SELECT p.mac_hash AS macHash, p.id_sensor AS idSensor, p.pos_x AS posX, p.pos_y AS posY, p.rssi
             FROM (
                 SELECT t.mac_hash, t.id_sensor, t.pos_x, t.pos_y, t.rssi,
                        ROW_NUMBER() OVER (PARTITION BY t.mac_hash, t.id_sensor ORDER BY t.rssi) AS orden,
                        COUNT(*) OVER (PARTITION BY t.mac_hash, t.id_sensor) AS tramas
                 FROM (
                     SELECT c.mac_hash, c.id_sensor, c.rssi, c.timestamp_captura, s.pos_x, s.pos_y,
                            MAX(c.timestamp_captura) OVER (PARTITION BY c.mac_hash) AS ultima
                     FROM captura c ${ANTES_LAS_CAPTURAS} sensor s ON s.id_sensor = c.id_sensor
                     WHERE s.id_zona = ? AND s.pos_x IS NOT NULL AND s.pos_y IS NOT NULL
                       AND c.timestamp_captura >= ? AND c.timestamp_captura <= ?
                 ) t
                 WHERE t.timestamp_captura >= t.ultima - INTERVAL ? SECOND
             ) p
             WHERE p.orden = FLOOR(${PERCENTIL_POSICION} * (p.tramas - 1)) + 1`,
            [idZona, desde, hasta, episodioS],
        );

        return filas.map((fila) => ({
            macHash: fila.macHash,
            idSensor: fila.idSensor,
            posX: Number(fila.posX),
            posY: Number(fila.posY),
            rssi: Number(fila.rssi),
        }));
    }

    /**
     * Señal media de cada dispositivo en cada nodo dentro de una ventana, que es
     * lo que necesita el criterio de presencia.
     *
     * Promedia el RSSI por pareja dispositivo-nodo por el mismo motivo que
     * {@link senalesDeNodosSituados}: una trama aislada fluctúa varios dB sin que
     * nadie se mueva.
     *
     * @param desde  - Inicio de la ventana, inclusivo.
     * @param hasta  - Fin de la ventana, exclusivo.
     * @param idZona - Limita la consulta a una zona; sin ella, todas.
     */
    async senalesPorNodo(desde: Date, hasta: Date, idZona?: string): Promise<SenalEnZona[]> {
        const filtroZona = idZona ? 'AND s.id_zona = ?' : '';
        const filas: { idZona: string; macHash: string; idSensor: string; rssi: string; esMacRandom: string | number }[] =
            await this.repo.query(
                `SELECT s.id_zona AS idZona, c.mac_hash AS macHash, c.id_sensor AS idSensor,
                        AVG(c.rssi) AS rssi, MAX(c.es_mac_random) AS esMacRandom
                 FROM captura c ${ANTES_LAS_CAPTURAS} sensor s ON s.id_sensor = c.id_sensor
                 WHERE c.timestamp_captura >= ? AND c.timestamp_captura < ? ${filtroZona}
                 GROUP BY s.id_zona, c.mac_hash, c.id_sensor`,
                idZona ? [desde, hasta, idZona] : [desde, hasta],
            );

        return filas.map((fila) => ({
            idZona: fila.idZona,
            macHash: fila.macHash,
            idSensor: fila.idSensor,
            rssi: Number(fila.rssi),
            esMacRandom: Number(fila.esMacRandom) === 1,
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
    deteccionesDesde(since: Date): Promise<number> {
        return this.repo
            .createQueryBuilder('c')
            .where('c.timestampCaptura >= :since', { since })
            .getCount();
    }
}
