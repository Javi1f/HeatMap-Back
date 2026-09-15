import { injectable } from 'tsyringe';
import { NotFoundError, ValidationError } from '../../common/errors';
import { CapturaRepository, DistanciaPorNodo } from '../sensor/repositories/captura.repository';
import { SensorRepository } from '../sensor/repositories/sensor.repository';
import { ZonaRepository } from '../sensor/repositories/zona.repository';
import {
    Limites,
    Observacion,
    PositioningService,
} from '../sensor/services/positioning.service';
import { PresenciaService } from '../sensor/services/presencia.service';
import { crearCacheTemporal } from '../../common/utils/cache-temporal';

/** Lado de cada celda de la rejilla, en metros. */
const LADO_CELDA_M = 0.5;

/** Ventana por defecto que abarca el mapa, en minutos. */
const VENTANA_POR_DEFECTO_MIN = 5;

/**
 * Mapas recientes, compartidos entre peticiones.
 *
 * La interfaz recarga el mapa hasta cada 2 s al llegar lecturas para cumplir
 * el tiempo de respuesta de 5 s, y con varios visitantes eso serían varias
 * consultas pesadas por segundo con el mismo resultado. Un segundo de caché
 * deja como mucho una consulta por segundo por zona, haya los visitantes que
 * haya, y suma a lo sumo 1 s al tiempo de reflejo.
 */
const mapasRecientes = crearCacheTemporal<MapaDeCalor>(1_000);

/** Ventana máxima admitida, en minutos. */
const VENTANA_MAXIMA_MIN = 120;

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
     * Conteo por celda.
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
     * Ocurre cuando la trilateración no tiene solución o cae claramente fuera
     * del espacio. Se informa porque cambia cómo leer el mapa: una cifra alta
     * significa que el mapa describe a una minoría.
     *
     * Con `situados` suma exactamente los dispositivos presentes, que es la
     * cifra que muestra la cabecera de la página.
     */
    sinPosicion: number;

    /** Descartados por ser infraestructura: puntos de acceso, equipos junto a un nodo o exclusiones manuales. */
    descartadosInfraestructura: number;

    /** Descartados porque su señal no es compatible con estar dentro del espacio. */
    descartadosFueraDeZona: number;

    /** Nodos de la zona, con su posición en el plano. */
    nodos: NodoEnMapa[];

    /** Inicio de la ventana, en ISO. */
    desde: string;

    /** Fin de la ventana, en ISO. */
    hasta: string;
}

/**
 * Corrección vertical de las posiciones declarada por la zona, en metros.
 *
 * Con los nodos en dos esquinas de un lado y el tercero en el centro del
 * opuesto, la trilateración por RSSI sitúa sistemáticamente más cerca del lado
 * de los dos nodos: la geometría lo favorece y el nodo solitario suele oír más
 * débil. En la plazoleta se midió con un portátil quieto en un punto conocido,
 * que salía de media 2,8 m por debajo de su sitio. Como el sesgo depende de cómo
 * está montado cada espacio, se declara por zona en `coordenadas.ajusteVerticalM`
 * y no como constante; sin él no se corrige nada.
 */
const leerAjusteVertical = (coordenadas: Record<string, unknown> | null): number => {
    const ajuste = Number(coordenadas?.ajusteVerticalM ?? 0);
    return Number.isFinite(ajuste) ? ajuste : 0;
};

/**
 * Extrae ancho y alto de la geometría guardada en la zona.
 *
 * @returns Los límites, o `null` si la zona no los declara o no son válidos.
 */
const leerGeometria = (coordenadas: Record<string, unknown> | null): Limites | null => {
    if (!coordenadas) return null;

    const ancho = Number(coordenadas.ancho);
    const alto = Number(coordenadas.alto);

    if (!Number.isFinite(ancho) || !Number.isFinite(alto)) return null;
    if (ancho <= 0 || alto <= 0) return null;

    return { ancho, alto };
};

/** Restringe un valor al rango indicado, ambos extremos incluidos. */
const acotar = (valor: number, min: number, max: number): number => Math.min(Math.max(valor, min), max);

/**
 * Construye mapas de calor de ocupación a partir de las detecciones crudas.
 *
 * **El recorrido**: se toman las detecciones de la ventana, se descarta lo que
 * no está de verdad en el espacio (ver {@link PresenciaService}), se promedia la
 * distancia de cada dispositivo restante a cada nodo, se sitúa por
 * trilateración y se cuentan las posiciones por celda.
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
        const zona = await this.zonas.findById(idZona);
        if (!zona) throw new NotFoundError('La zona no existe');

        const limites = leerGeometria(zona.coordenadas);
        if (!limites) {
            throw new ValidationError(
                'La zona no tiene geometría definida. Registra su ancho y alto en metros antes de generar el mapa.',
            );
        }

        const ventana = Math.min(Math.max(minutos, 1), VENTANA_MAXIMA_MIN);
        const hasta = new Date();
        const desde = new Date(hasta.getTime() - ventana * 60_000);

        const [lecturas, evaluaciones] = await Promise.all([
            this.capturas.distanciasPorNodo(idZona, desde, hasta),
            this.presencia.evaluar(desde, hasta, idZona),
        ]);
        const evaluacion = evaluaciones.get(idZona);
        const presentes = evaluacion?.presentes ?? new Map();

        const { rejilla, maximo, situados } = this.rasterizar(
            lecturas.filter((lectura) => presentes.has(lectura.macHash)),
            limites,
            leerAjusteVertical(zona.coordenadas),
        );

        const nodosConDatos = new Set(lecturas.map((lectura) => lectura.idSensor));
        const nodos = (await this.sensores.findAll())
            .filter((sensor) => sensor.idZona === idZona && sensor.posX !== null && sensor.posY !== null)
            .map((sensor) => ({
                idSensor: sensor.idSensor,
                nombre: sensor.nombre,
                x: sensor.posX as number,
                y: sensor.posY as number,
                aportoDatos: nodosConDatos.has(sensor.idSensor),
            }));

        return {
            idZona: zona.idZona,
            nombre: zona.nombre,
            ancho: limites.ancho,
            alto: limites.alto,
            ladoCelda: LADO_CELDA_M,
            columnas: rejilla[0]?.length ?? 0,
            filas: rejilla.length,
            rejilla,
            maximo,
            situados,
            sinPosicion: presentes.size - situados,
            descartadosInfraestructura: evaluacion?.descartadosInfraestructura ?? 0,
            descartadosFueraDeZona: evaluacion?.descartadosFueraDeZona ?? 0,
            nodos,
            desde: desde.toISOString(),
            hasta: hasta.toISOString(),
        };
    }

    /**
     * Sitúa cada dispositivo y acumula las posiciones en la rejilla.
     *
     * La corrección vertical se aplica después de situar y no antes: el
     * posicionador sigue descartando lo que cae fuera con la estimación cruda, y
     * sólo se desplaza lo que ya se aceptó.
     */
    private rasterizar(
        lecturas: DistanciaPorNodo[],
        limites: Limites,
        ajusteVerticalM: number,
    ): { rejilla: number[][]; maximo: number; situados: number } {
        const columnas = Math.max(1, Math.ceil(limites.ancho / LADO_CELDA_M));
        const filas = Math.max(1, Math.ceil(limites.alto / LADO_CELDA_M));
        const rejilla: number[][] = Array.from({ length: filas }, () => new Array<number>(columnas).fill(0));

        // Agrupar por dispositivo: cada uno aporta una observación por nodo.
        const porDispositivo = new Map<string, Observacion[]>();
        for (const lectura of lecturas) {
            const obs = porDispositivo.get(lectura.macHash) ?? [];
            obs.push({ x: lectura.posX, y: lectura.posY, d: lectura.distancia });
            porDispositivo.set(lectura.macHash, obs);
        }

        let maximo = 0;
        let situados = 0;

        for (const obs of porDispositivo.values()) {
            const punto = this.posicionador.estimar(obs, limites);
            if (!punto) continue;

            // Una posición admitida puede caer en el margen exterior tolerado;
            // se pega al borde para que siga contando en el mapa.
            const col = acotar(Math.floor(punto.x / LADO_CELDA_M), 0, columnas - 1);
            const fil = acotar(Math.floor((punto.y + ajusteVerticalM) / LADO_CELDA_M), 0, filas - 1);

            rejilla[fil][col]++;
            situados++;
            if (rejilla[fil][col] > maximo) maximo = rejilla[fil][col];
        }

        return { rejilla, maximo, situados };
    }
}
