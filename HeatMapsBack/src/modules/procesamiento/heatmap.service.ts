import { injectable } from 'tsyringe';
import { NotFoundError, ValidationError } from '../../common/errors';
import { CapturaRepository, SenalDeNodoSituado } from '../../persistencia/repositorios/captura.repository';
import { SensorRepository } from '../../persistencia/repositorios/sensor.repository';
import { ZonaRepository } from '../../persistencia/repositorios/zona.repository';
import {
    Limites,
    Observacion,
    PositioningService,
    Punto,
    RUIDO_ENLACE_DB,
} from './positioning.service';
import { DistanceEstimatorService } from './distance-estimator.service';
import { PresenciaService } from './presencia.service';
import { LoggerService } from '../../common/logger/logger.service';
import type { EvaluacionPresencia } from './presencia';
import { crearCacheTemporal } from '../../common/utils/cache-temporal';

/** Lado de cada celda de la rejilla, en metros. */
const LADO_CELDA_M = 0.5;

/** Ventana por defecto que abarca el mapa, en minutos. */
const VENTANA_POR_DEFECTO_MIN = 5;

/**
 * Tiempo tras caducar durante el que se sigue sirviendo un mapa mientras se
 * calcula el siguiente. Cubre de sobra un recálculo normal (~3 s); si la base
 * deja de responder, pasado este margen se espera al cálculo en lugar de
 * mostrar un mapa congelado como si fuera actual.
 */
const MAPA_CADUCADO_SERVIBLE_MS = 15_000;

/**
 * Mapas recientes, compartidos entre peticiones.
 *
 * La interfaz recarga el mapa hasta cada 2 s al llegar lecturas para cumplir
 * el tiempo de respuesta de 5 s, y con varios visitantes eso serían varias
 * consultas pesadas por segundo con el mismo resultado. Un segundo de caché
 * deja como mucho una consulta por segundo por zona, haya los visitantes que
 * haya, y suma a lo sumo 1 s al tiempo de reflejo.
 *
 * Mientras se recalcula se sirve el mapa anterior (ver
 * {@link MAPA_CADUCADO_SERVIBLE_MS}): calcularlo cuesta unos 3 s contra la base
 * remota, y sin esto todas las peticiones de ese rato esperaban. En la prueba
 * de carga (CP-21) era el percentil 95.
 */
const mapasRecientes = crearCacheTemporal<MapaDeCalor>(1_000, Date.now, MAPA_CADUCADO_SERVIBLE_MS);

/** Ventana máxima admitida, en minutos. */
const VENTANA_MAXIMA_MIN = 120;

/**
 * Segundos de lecturas, contados hacia atrás desde la última de cada
 * dispositivo, con los que se decide dónde está.
 *
 * La ventana del mapa dice **quién** ha estado; dónde está cada uno lo dicen
 * sus lecturas más recientes. Un minuto son unas quince lecturas por nodo, que
 * bastan para promediar el ruido del RSSI sin mezclar dos sitios distintos si
 * el dispositivo se movió.
 */
const EPISODIO_POSICION_S = 60;

/**
 * Último aviso de desajuste de cada zona, en milisegundos.
 *
 * Fuera de la clase porque el servicio se resuelve por petición: guardado
 * dentro, cada mapa creería que no ha avisado nunca y el registro se llenaría
 * del mismo aviso varias veces por segundo.
 */
const avisosDeDesajuste = new Map<string, number>();

/** Cada cuánto se repite el aviso de desajuste de una misma zona. */
const AVISO_DESAJUSTE_MS = 10 * 60_000;

/**
 * Desajuste del modelo a partir del cual se avisa, en dB.
 *
 * Por debajo de 3 dB la diferencia entra en el propio ruido de la señal. Por
 * encima, las distancias que el sistema guarda no describen el espacio, aunque
 * el mapa siga bien situado porque no depende de esa escala.
 */
const DESAJUSTE_TOLERABLE_DB = 3;

/** Nodo tal como se dibuja sobre el plano. */
export interface NodoEnMapa {
    /** Identificador del nodo. */
    idSensor: string;

    /** Nombre legible. */
    nombre: string;

    /** Metros desde el borde izquierdo. */
    x: number;

    /** Metros desde el borde inferior. */
    y: number;

    /** `true` si aportó detecciones a esta ventana. */
    aportoDatos: boolean;
}

/** Mapa de calor de una zona en una ventana temporal. */
export interface MapaDeCalor {
    /** Identificador de la zona. */
    idZona: string;

    /** Nombre legible del espacio. */
    nombre: string;

    /** Anchura de la zona en metros (eje X). */
    ancho: number;

    /** Altura de la zona en metros (eje Y). */
    alto: number;

    /** Lado de cada celda en metros. */
    ladoCelda: number;

    /** Número de columnas de la rejilla. */
    columnas: number;

    /** Número de filas de la rejilla. */
    filas: number;

    /**
     * Conteo por celda: cuántos dispositivos se situaron en ella.
     *
     * `rejilla[0]` es la fila inferior de la zona, la de `y = 0`. El lienzo del
     * navegador tiene el origen arriba, así que el cliente invierte el eje al
     * dibujar; se deja en coordenadas del mundo para que los datos se puedan
     * leer sin conocer el detalle de la representación.
     */
    rejilla: number[][];

    /** Mayor conteo de una celda, para normalizar la escala de color. */
    maximo: number;

    /** Dispositivos presentes a los que se pudo asignar una posición. */
    situados: number;

    /**
     * Dispositivos presentes que no se pudieron situar.
     *
     * Ocurre si ninguno de los nodos que lo oyeron tiene posición en el plano,
     * si el modelo no pudo convertir su señal en distancia o si las distancias
     * no admiten una posición. Se informa porque cambia
     * cómo leer el mapa: una cifra alta significa que el mapa describe a una
     * minoría.
     *
     * Con `situados` suma exactamente los dispositivos presentes, que es la
     * cifra que muestra la cabecera de la página.
     */
    sinPosicion: number;

    /** Descartados por ser infraestructura: puntos de acceso, equipos junto a un nodo o exclusiones manuales. */
    descartadosInfraestructura: number;

    /** Descartados porque su señal no es compatible con estar dentro del espacio. */
    descartadosFueraDeZona: number;

    /**
     * Desajuste del modelo de propagación medido en esta ventana, en dB.
     *
     * Es lo que habría que restar a `RSSI_REFERENCE_DBM` para que las distancias
     * estimadas coincidieran con la geometría de las posiciones halladas. Cerca
     * de 0 el modelo está calibrado para este espacio; lejos, las distancias
     * están sistemáticamente mal aunque el mapa siga siendo correcto, porque el
     * posicionador no depende de esa escala. `null` si no hubo ninguna posición
     * de la que deducirlo.
     */
    desajusteReferenciaDb: number | null;

    /** Nodos de la zona, con su posición en el plano. */
    nodos: NodoEnMapa[];

    /** Inicio de la ventana, en ISO. */
    desde: string;

    /** Fin de la ventana, en ISO. */
    hasta: string;
}

/** `true` si la medida es un número finito y positivo. */
const esMedidaValida = (medida: number): boolean => Number.isFinite(medida) && medida > 0;

/**
 * Extrae ancho y alto de la geometría guardada en la zona.
 *
 * @returns Los límites, o `null` si la zona no los declara o no son válidos.
 */
const leerGeometria = (coordenadas: Record<string, unknown> | null): Limites | null => {
    if (!coordenadas) return null;

    const ancho = Number(coordenadas.ancho);
    const alto = Number(coordenadas.alto);
    return esMedidaValida(ancho) && esMedidaValida(alto) ? { ancho, alto } : null;
};

/** Evaluación de una zona sin ninguna detección en la ventana. */
const SIN_EVALUACION: Readonly<EvaluacionPresencia> = {
    presentes: new Map(),
    descartadosInfraestructura: 0,
    descartadosFueraDeZona: 0,
};

/** Mediana de una lista, o `null` si está vacía. */
const mediana = (valores: readonly number[]): number | null => {
    if (valores.length === 0) return null;
    const ordenados = [...valores].sort((uno, otro) => uno - otro);
    const mitad = Math.floor(ordenados.length / 2);
    return ordenados.length % 2 === 1 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
};

/** Restringe un valor al rango indicado, ambos extremos incluidos. */
const acotar = (valor: number, min: number, max: number): number => Math.min(Math.max(valor, min), max);

/**
 * Construye mapas de calor de ocupación a partir de las detecciones crudas.
 *
 * **El recorrido**: se toman las detecciones de la ventana, se descarta lo que
 * no está de verdad en el espacio (ver {@link PresenciaService}), se promedia la
 * señal de cada dispositivo restante en cada nodo, se traduce a distancia, se
 * sitúa por multilateración (ver {@link PositioningService}) y se cuentan las
 * posiciones por celda. El cliente dibuja una mancha alrededor de cada celda
 * ocupada: el tamaño de la mancha ya expresa que la posición tiene un error de
 * metros, sin repartirla en el servidor.
 *
 * **Por qué una rejilla y no las posiciones sueltas**: devolver la coordenada
 * de cada dispositivo permitiría reconstruir trayectorias individuales, que es
 * justo lo que el proyecto se compromete a no hacer. Agregando a celdas de
 * medio metro se conserva la forma de la concentración y se pierde el rastro
 * de la persona.
 */
@injectable()
export class HeatmapService {
    constructor(
        private readonly capturas: CapturaRepository,
        private readonly sensores: SensorRepository,
        private readonly zonas: ZonaRepository,
        private readonly posicionador: PositioningService,
        private readonly presencia: PresenciaService,
        private readonly distancias: DistanceEstimatorService,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Genera el mapa de calor de una zona.
     *
     * @param idZona  - Zona a representar.
     * @param minutos - Ventana hacia atrás desde ahora.
     * @throws NotFoundError   si la zona no existe.
     * @throws ValidationError si la zona no tiene geometría definida.
     */
    generar(idZona: string, minutos = VENTANA_POR_DEFECTO_MIN): Promise<MapaDeCalor> {
        return mapasRecientes.obtener(`${idZona}:${minutos}`, () => this.calcular(idZona, minutos));
    }

    /** Calcula el mapa sin pasar por la caché. */
    private async calcular(idZona: string, minutos: number): Promise<MapaDeCalor> {
        const { nombre, limites } = await this.zonaConGeometria(idZona);

        const ventana = Math.min(Math.max(minutos, 1), VENTANA_MAXIMA_MIN);
        const hasta = new Date();
        const desde = new Date(hasta.getTime() - ventana * 60_000);

        const [senales, evaluaciones] = await Promise.all([
            this.capturas.senalesDeNodosSituados(idZona, desde, hasta, EPISODIO_POSICION_S),
            this.presencia.evaluar(desde, hasta, idZona),
        ]);
        const evaluacion = evaluaciones.get(idZona) ?? SIN_EVALUACION;

        const observaciones = this.observacionesPorDispositivo(
            senales.filter((senal) => evaluacion.presentes.has(senal.macHash)),
        );
        const { rejilla, maximo, situados, escalas } = this.rasterizar(observaciones, limites);
        const desajuste = this.desajusteDe(escalas);
        this.avisarDesajuste(idZona, desajuste);

        return {
            idZona,
            nombre,
            ancho: limites.ancho,
            alto: limites.alto,
            ladoCelda: LADO_CELDA_M,
            // `rasterizar` garantiza al menos una fila y una columna.
            columnas: rejilla[0].length,
            filas: rejilla.length,
            rejilla,
            maximo,
            situados,
            sinPosicion: evaluacion.presentes.size - situados,
            descartadosInfraestructura: evaluacion.descartadosInfraestructura,
            descartadosFueraDeZona: evaluacion.descartadosFueraDeZona,
            desajusteReferenciaDb: desajuste,
            nodos: await this.nodosDeZona(idZona, senales),
            desde: desde.toISOString(),
            hasta: hasta.toISOString(),
        };
    }

    /**
     * Busca la zona y lee su geometría.
     *
     * @throws NotFoundError   si la zona no existe.
     * @throws ValidationError si la zona no tiene geometría definida.
     */
    private async zonaConGeometria(idZona: string): Promise<{ nombre: string; limites: Limites }> {
        const zona = await this.zonas.findById(idZona);
        if (!zona) throw new NotFoundError('La zona no existe');

        const limites = leerGeometria(zona.coordenadas);
        if (!limites) {
            throw new ValidationError(
                'La zona no tiene geometría definida. Registra su ancho y alto en metros antes de generar el mapa.',
            );
        }
        return { nombre: zona.nombre, limites };
    }

    /** Nodos de la zona con posición, marcando los que aportaron lecturas a la ventana. */
    private async nodosDeZona(idZona: string, senales: readonly SenalDeNodoSituado[]): Promise<NodoEnMapa[]> {
        const nodosConDatos = new Set(senales.map((senal) => senal.idSensor));
        return (await this.sensores.findAll())
            .filter((sensor) => sensor.idZona === idZona && sensor.posX !== null && sensor.posY !== null)
            .map((sensor) => ({
                idSensor: sensor.idSensor,
                nombre: sensor.nombre,
                x: sensor.posX as number,
                y: sensor.posY as number,
                aportoDatos: nodosConDatos.has(sensor.idSensor),
            }));
    }

    /**
     * Agrupa las señales por dispositivo y las traduce a distancias.
     *
     * Cada dispositivo queda con una observación por nodo que lo oyó, que es la
     * entrada que necesita el posicionador.
     */
    private observacionesPorDispositivo(senales: readonly SenalDeNodoSituado[]): Map<string, Observacion[]> {
        const porDispositivo = new Map<string, Observacion[]>();

        for (const senal of senales) {
            const distancia = this.distancias.estimate(senal.rssi);
            if (distancia === null) continue;

            const obs = porDispositivo.get(senal.macHash) ?? [];
            obs.push({ x: senal.posX, y: senal.posY, d: distancia });
            porDispositivo.set(senal.macHash, obs);
        }
        return porDispositivo;
    }

    /**
     * Sitúa cada dispositivo y acumula las posiciones en la rejilla.
     *
     * Con dos nodos o más se usa la posición estimada; oído por un solo nodo
     * situado, se coloca junto a él, que es todo lo que esa medida dice. Una
     * posición en el margen exterior tolerado se pega al borde para que siga
     * contando en el mapa.
     */
    private rasterizar(
        observaciones: ReadonlyMap<string, Observacion[]>,
        limites: Limites,
    ): { rejilla: number[][]; maximo: number; situados: number; escalas: number[] } {
        const columnas = Math.max(1, Math.ceil(limites.ancho / LADO_CELDA_M));
        const filas = Math.max(1, Math.ceil(limites.alto / LADO_CELDA_M));
        const rejilla: number[][] = Array.from({ length: filas }, () => new Array<number>(columnas).fill(0));
        const escalas: number[] = [];
        let situados = 0;

        for (const obs of observaciones.values()) {
            const situado = this.situar(obs, limites);
            if (!situado) continue;

            const col = acotar(Math.floor(situado.punto.x / LADO_CELDA_M), 0, columnas - 1);
            const fil = acotar(Math.floor(situado.punto.y / LADO_CELDA_M), 0, filas - 1);
            rejilla[fil][col]++;
            situados++;
            if (situado.escala !== null) escalas.push(situado.escala);
        }

        return { rejilla, maximo: Math.max(0, ...rejilla.flat()), situados, escalas };
    }

    /**
     * Posición de un dispositivo y, si salió de cruzar varios nodos, el factor
     * de escala que midió el posicionador.
     *
     * `obs` nunca está vacío: `observacionesPorDispositivo` sólo crea entradas
     * con alguna distancia.
     */
    private situar(obs: readonly Observacion[], limites: Limites): { punto: Punto; escala: number | null } | null {
        if (obs.length === 1) return { punto: obs[0], escala: null };
        const estimacion = this.posicionador.estimar(obs, limites, this.distancias.aLogDistancia(RUIDO_ENLACE_DB));
        return estimacion && { punto: estimacion, escala: estimacion.factorEscala };
    }

    /** Desajuste del modelo de propagación que se deduce de las posiciones halladas. */
    private desajusteDe(escalas: readonly number[]): number | null {
        const escala = mediana(escalas);
        return escala === null ? null : this.distancias.desajusteDb(escala);
    }

    /**
     * Avisa de que el modelo de propagación necesita recalibrarse, sin repetirlo
     * en cada recarga del mapa.
     *
     * El aviso no es un fallo: el mapa sigue situando bien a la gente porque el
     * posicionador no usa la escala. Lo que está mal son las distancias que se
     * guardan en cada detección, y el número que se registra es exactamente la
     * corrección que hay que aplicar.
     */
    private avisarDesajuste(idZona: string, desajuste: number | null): void {
        if (desajuste === null || Math.abs(desajuste) < DESAJUSTE_TOLERABLE_DB) return;

        const ahora = Date.now();
        if (ahora - (avisosDeDesajuste.get(idZona) ?? 0) < AVISO_DESAJUSTE_MS) return;
        avisosDeDesajuste.set(idZona, ahora);

        this.logger.warn(
            `El modelo de propagación de la zona ${idZona} desvía ${desajuste} dB. `
            + `Resta ese valor a RSSI_REFERENCE_DBM para que las distancias estimadas cuadren con la geometría; `
            + `el mapa de calor no depende de esa escala.`,
        );
    }
}
