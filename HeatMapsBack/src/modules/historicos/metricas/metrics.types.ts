/**
 * Formas de respuesta del módulo de métricas.
 *
 * Se declaran aquí y no en `types/` porque solo las consume este módulo y su
 * cliente; mantenerlas juntas evita que el barrel global crezca con tipos de
 * una sola pantalla.
 */

/** Estado de salud de un nodo de captura. */
export interface SensorHealth {
    /** Identificador que el propio nodo publica en Kafka. */
    idSensor: string;

    /** Nombre legible del nodo. */
    nombre: string;

    /** Zona a la que está asignado, o `null` si no se pudo resolver. */
    zona: string | null;

    /** Estado operativo: `activo`, `inactivo` o `mantenimiento`. */
    estado: string;

    /** Marca ISO de la última lectura recibida, o `null` si nunca emitió. */
    ultimaConexion: string | null;

    /** Minutos transcurridos desde la última lectura, `null` si nunca emitió. */
    minutosDesdeUltimaLectura: number | null;

    /** `true` si emitió dentro de la ventana considerada saludable. */
    enLinea: boolean;
}

/** Ocupación actual de una zona. */
export interface ZoneOccupancy {
    /** Identificador de la zona. */
    idZona: string;

    /** Nombre legible del espacio. */
    nombre: string;

    /** Aforo declarado, o `null` si la institución no lo ha fijado. */
    capacidadMax: number | null;

    /**
     * MAC distintas en la última ventana consolidada. Es el techo del conteo:
     * una MAC aleatorizada que rote dentro de la ventana suma varias veces.
     */
    dispositivosUnicos: number;

    /** Subconjunto con MAC de fabricante. Es el suelo fiable del conteo. */
    dispositivosEstables: number;

    /** RSSI medio de las detecciones de la zona, en dBm. */
    rssiPromedio: number | null;

    /** Nivel derivado del conteo frente al aforo de la zona. */
    nivelOcupacion: string;

    /** Ocupación sobre el aforo, en porcentaje. `null` si no hay aforo declarado. */
    porcentajeAforo: number | null;

    /** Cierre de la ventana consolidada de la que salen estos números. */
    actualizadoEn: string | null;
}

/** Punto de una serie temporal de ocupación. */
export interface OccupancyPoint {
    /** Inicio ISO de la ventana que representa el punto. */
    intervaloInicio: string;

    /** Zona a la que pertenece el punto. */
    idZona: string;

    /** MAC distintas contadas en la ventana. */
    dispositivosUnicos: number;

    /** MAC de fabricante contadas en la ventana. */
    dispositivosEstables: number;

    /** Nivel de ocupación asignado a la ventana. */
    nivelOcupacion: string;
}

/** Tarjetas de cabecera del dashboard. */
export interface MetricsOverview {
    /**
     * Dispositivos distintos vistos en la ventana reciente. No equivale al
     * número de personas presentes.
     */
    dispositivosAhora: number;

    /** Tramas capturadas en esa misma ventana, sumando todos los nodos. */
    detecciones: number;

    /**
     * Porcentaje de las MAC distintas que estaban aleatorizadas. Cuanto más
     * alto, menos fiable resulta `dispositivosAhora` como conteo de personas.
     */
    porcentajeRandomizadas: number;

    /** Potencia media de las detecciones, en dBm. */
    rssiPromedio: number | null;

    /** Número de zonas marcadas como activas. */
    zonasActivas: number;

    /** Nodos de captura registrados, emitan o no. */
    sensoresTotal: number;

    /** Nodos que han emitido dentro de la ventana considerada saludable. */
    sensoresEnLinea: number;

    /** Alertas de aglomeración todavía sin resolver. */
    alertasAbiertas: number;

    /** Minutos de la ventana usada para los números «ahora». */
    ventanaMinutos: number;
}
