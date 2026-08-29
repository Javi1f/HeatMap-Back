import { injectable } from 'tsyringe';
import { HeatmapService, MapaDeCalor } from '../metrics/heatmap.service';
import { OcupacionRepository } from '../sensor/repositories/ocupacion.repository';
import { ZonaRepository } from '../sensor/repositories/zona.repository';

/** Espacio tal como se ofrece a cualquier visitante. */
export interface ZonaPublica {
    /** Identificador de la zona, necesario para pedir su mapa. */
    idZona: string;

    /** Nombre del espacio. */
    nombre: string;

    /** Descripción breve, si la tiene. */
    descripcion: string | null;

    /**
     * Nivel de ocupación de la última ventana consolidada.
     *
     * Se ofrece como categoría y no como número: al visitante le sirve para
     * decidir a qué espacio ir, y publicar el conteo exacto daría una precisión
     * que la estimación por RSSI no tiene.
     */
    nivelOcupacion: 'baja' | 'media' | 'alta' | 'sin datos';
}

/**
 * Nodo tal como se muestra en el mapa público.
 *
 * Solo posición y nombre. El identificador interno queda fuera: al visitante no
 * le dice nada y es detalle de infraestructura.
 */
export interface NodoPublico {
    /** Nombre legible del nodo. */
    nombre: string;

    /** Metros desde el borde izquierdo. */
    x: number;

    /** Metros desde el borde inferior. */
    y: number;

    /** `true` si aportó detecciones a esta ventana. */
    aportoDatos: boolean;
}

/**
 * Mapa de calor sin ningún dato de infraestructura ni de dispositivo.
 *
 * Es deliberadamente un tipo distinto del que consume el panel, y no el mismo
 * con campos omitidos: así, si mañana el mapa interno gana un campo sensible,
 * no se filtra solo por compartir la estructura.
 */
export interface MapaPublico {
    /** Nombre del espacio. */
    nombre: string;

    /** Anchura de la zona en metros. */
    ancho: number;

    /** Altura de la zona en metros. */
    alto: number;

    /** Lado de cada celda en metros. */
    ladoCelda: number;

    /** Número de columnas de la rejilla. */
    columnas: number;

    /** Número de filas de la rejilla. */
    filas: number;

    /** Conteo por celda. `rejilla[0]` es la fila inferior del espacio. */
    rejilla: number[][];

    /** Mayor conteo de una celda, para normalizar la escala de color. */
    maximo: number;

    /** Dispositivos situados en el plano. */
    situados: number;

    /** Nodos con su posición. */
    nodos: NodoPublico[];

    /** Minutos que abarca la ventana representada. */
    ventanaMinutos: number;

    /** Fin de la ventana, en ISO. */
    hasta: string;
}

/**
 * Vista pública del sistema: qué puede consultar cualquiera sin autenticarse.
 *
 * **Por qué es un módulo aparte y no unos endpoints sueltos**: todo lo que
 * cuelga de `/api/publico` es legible por cualquiera que conozca la URL, y
 * tenerlo reunido convierte esa frontera en algo que se puede revisar de una
 * ojeada. Mezclarlo con las rutas del panel haría que la diferencia entre lo
 * abierto y lo protegido dependiera de leer el middleware de cada ruta.
 *
 * **Qué nunca sale de aquí**: identificadores de dispositivo, direcciones MAC
 * —ni siquiera anonimizadas—, RSSI por dispositivo, identificadores internos de
 * nodo y cualquier dato que permita seguir a alguien. Solo agregados por celda
 * y la geometría del espacio.
 */
@injectable()
export class PublicoService {
    constructor(
        private readonly heatmap: HeatmapService,
        private readonly zonas: ZonaRepository,
        private readonly ocupacion: OcupacionRepository,
    ) {}

    /**
     * Espacios que el visitante puede consultar.
     *
     * Solo los que tienen geometría definida: sin ancho y alto no hay plano que
     * dibujar, y ofrecerlos daría un mapa vacío sin explicación.
     */
    async listarZonas(): Promise<ZonaPublica[]> {
        const [activas, ultimas] = await Promise.all([
            this.zonas.findActive(),
            this.ocupacion.findLatestPerZone(),
        ]);

        const nivelPorZona = new Map(ultimas.map((o) => [o.idZona, o.nivelOcupacion]));

        return activas
            .filter((z) => tieneGeometria(z.coordenadas))
            .map((z) => ({
                idZona: z.idZona,
                nombre: z.nombre,
                descripcion: z.descripcion,
                nivelOcupacion: nivelPorZona.get(z.idZona) ?? 'sin datos',
            }));
    }

    /**
     * Mapa de calor de un espacio, despojado de todo dato sensible.
     *
     * @param idZona  - Espacio a representar.
     * @param minutos - Ventana hacia atrás desde ahora.
     */
    async mapa(idZona: string, minutos?: number): Promise<MapaPublico> {
        const completo = await this.heatmap.generar(idZona, minutos);
        return this.despojar(completo);
    }

    /**
     * Proyecta el mapa interno a su versión pública.
     *
     * Construye el objeto campo a campo en lugar de copiar y borrar: lo que no
     * se nombra aquí no puede salir, aunque el mapa interno crezca.
     */
    private despojar(m: MapaDeCalor): MapaPublico {
        const ventanaMs = new Date(m.hasta).getTime() - new Date(m.desde).getTime();

        return {
            nombre: m.nombre,
            ancho: m.ancho,
            alto: m.alto,
            ladoCelda: m.ladoCelda,
            columnas: m.columnas,
            filas: m.filas,
            rejilla: m.rejilla,
            maximo: m.maximo,
            situados: m.situados,
            nodos: m.nodos.map((n) => ({
                nombre: n.nombre,
                x: n.x,
                y: n.y,
                aportoDatos: n.aportoDatos,
            })),
            ventanaMinutos: Math.round(ventanaMs / 60_000),
            hasta: m.hasta,
        };
    }
}

/** `true` si la zona declara un ancho y un alto utilizables. */
function tieneGeometria(coordenadas: Record<string, unknown> | null): boolean {
    if (!coordenadas) return false;
    const ancho = Number(coordenadas.ancho);
    const alto = Number(coordenadas.alto);
    return Number.isFinite(ancho) && Number.isFinite(alto) && ancho > 0 && alto > 0;
}
