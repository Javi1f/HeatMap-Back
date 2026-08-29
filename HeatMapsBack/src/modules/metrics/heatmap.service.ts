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

/** Lado de cada celda de la rejilla, en metros. */
const LADO_CELDA_M = 0.5;

/** Ventana por defecto que abarca el mapa, en minutos. */
const VENTANA_POR_DEFECTO_MIN = 5;

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

    /** Dispositivos a los que se pudo asignar una posición. */
    situados: number;

    /**
     * Dispositivos detectados que no se pudieron situar.
     *
     * Ocurre cuando solo un nodo los vio, o cuando la posición resultante caía
     * claramente fuera del espacio. Se informa porque cambia cómo leer el mapa:
     * una cifra alta significa que el mapa describe a una minoría.
     */
    sinPosicion: number;

    /** Nodos de la zona, con su posición en el plano. */
    nodos: NodoEnMapa[];

    /** Inicio de la ventana, en ISO. */
    desde: string;

    /** Fin de la ventana, en ISO. */
    hasta: string;
}

/**
 * Construye mapas de calor de ocupación a partir de las detecciones crudas.
 *
 * **El recorrido**: se toman las detecciones de la ventana, se promedia la
 * distancia de cada dispositivo a cada nodo, se sitúa cada dispositivo por
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
    ) {}

    /**
     * Genera el mapa de calor de una zona.
     *
     * @param idZona  - Zona a representar.
     * @param minutos - Ventana hacia atrás desde ahora.
     * @throws NotFoundError   si la zona no existe.
     * @throws ValidationError si la zona no tiene geometría definida.
     */
    async generar(idZona: string, minutos = VENTANA_POR_DEFECTO_MIN): Promise<MapaDeCalor> {
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

        const lecturas = await this.capturas.distanciasPorNodo(idZona, desde, hasta);
        const { rejilla, maximo, situados, sinPosicion } = this.rasterizar(lecturas, limites);

        const nodosConDatos = new Set(lecturas.map((l) => l.idSensor));
        const nodos = (await this.sensores.findAll())
            .filter((s) => s.idZona === idZona && s.posX !== null && s.posY !== null)
            .map((s) => ({
                idSensor: s.idSensor,
                nombre: s.nombre,
                x: s.posX as number,
                y: s.posY as number,
                aportoDatos: nodosConDatos.has(s.idSensor),
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
            sinPosicion,
            nodos,
            desde: desde.toISOString(),
            hasta: hasta.toISOString(),
        };
    }

    /**
     * Sitúa cada dispositivo y acumula las posiciones en la rejilla.
     */
    private rasterizar(
        lecturas: DistanciaPorNodo[],
        limites: Limites,
    ): { rejilla: number[][]; maximo: number; situados: number; sinPosicion: number } {
        const columnas = Math.max(1, Math.ceil(limites.ancho / LADO_CELDA_M));
        const filas = Math.max(1, Math.ceil(limites.alto / LADO_CELDA_M));
        const rejilla: number[][] = Array.from({ length: filas }, () => new Array<number>(columnas).fill(0));

        // Agrupar por dispositivo: cada uno aporta una observación por nodo.
        const porDispositivo = new Map<string, Observacion[]>();
        for (const l of lecturas) {
            const obs = porDispositivo.get(l.macHash) ?? [];
            obs.push({ x: l.posX, y: l.posY, d: l.distancia });
            porDispositivo.set(l.macHash, obs);
        }

        let maximo = 0;
        let situados = 0;
        let sinPosicion = 0;

        for (const obs of porDispositivo.values()) {
            const punto = this.posicionador.estimar(obs, limites);
            if (!punto) {
                sinPosicion++;
                continue;
            }

            // Una posición admitida puede caer en el margen exterior tolerado;
            // se pega al borde para que siga contando en el mapa.
            const col = acotar(Math.floor(punto.x / LADO_CELDA_M), 0, columnas - 1);
            const fil = acotar(Math.floor(punto.y / LADO_CELDA_M), 0, filas - 1);

            rejilla[fil][col]++;
            situados++;
            if (rejilla[fil][col] > maximo) maximo = rejilla[fil][col];
        }

        return { rejilla, maximo, situados, sinPosicion };
    }
}

/**
 * Extrae ancho y alto de la geometría guardada en la zona.
 *
 * @returns Los límites, o `null` si la zona no los declara o no son válidos.
 */
function leerGeometria(coordenadas: Record<string, unknown> | null): Limites | null {
    if (!coordenadas) return null;

    const ancho = Number(coordenadas.ancho);
    const alto = Number(coordenadas.alto);

    if (!Number.isFinite(ancho) || !Number.isFinite(alto)) return null;
    if (ancho <= 0 || alto <= 0) return null;

    return { ancho, alto };
}

/** Restringe un valor al rango indicado, ambos extremos incluidos. */
const acotar = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);
