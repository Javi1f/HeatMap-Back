import { singleton } from 'tsyringe';

/** Punto en el plano de la zona, en metros desde la esquina inferior izquierda. */
export interface Punto {
    /** Metros desde el borde izquierdo. */
    x: number;
    /** Metros desde el borde inferior. */
    y: number;
}

/** Observación de un nodo: dónde está y a qué distancia estimó el dispositivo. */
export interface Observacion extends Punto {
    /** Distancia estimada al dispositivo, en metros. */
    d: number;
}

/** Rectángulo que delimita la zona, en metros. */
export interface Limites {
    /** Extensión en el eje X. */
    ancho: number;
    /** Extensión en el eje Y. */
    alto: number;
}

/**
 * Margen fuera de la zona que se tolera antes de descartar una posición.
 *
 * Una estimación puede caer ligeramente fuera del rectángulo por el ruido del
 * RSSI sin ser falsa: alguien apoyado en el borde. Más allá de este margen, la
 * solución no describe a nadie dentro del espacio y se descarta.
 */
const MARGEN_FUERA_M = 2;

/** Por debajo de este determinante los nodos se consideran alineados. */
const DET_MINIMO = 1e-9;

/**
 * Resuelve la posición con tres o más observaciones, por mínimos cuadrados.
 *
 * Restar la ecuación de una circunferencia a las demás elimina los términos
 * cuadráticos y deja un sistema lineal. Con tres nodos el sistema es exacto;
 * con más, se resuelve por mínimos cuadrados, que reparte el error del RSSI
 * entre todas las medidas en lugar de confiar en tres.
 *
 * @returns El punto, o `null` si los nodos están alineados y el sistema es
 *          indeterminado.
 */
const trilaterar = (obs: Observacion[]): Punto | null => {
    const ref = obs[0];

    // Ecuaciones normales del sistema linealizado: A·p = b, resuelto como
    // (AᵀA)·p = Aᵀb, que para dos incógnitas es un 2×2.
    let aa = 0;
    let ab = 0;
    let bb = 0;
    let ar = 0;
    let br = 0;

    for (let i = 1; i < obs.length; i++) {
        const obsI = obs[i];
        const coefX = 2 * (obsI.x - ref.x);
        const coefY = 2 * (obsI.y - ref.y);
        const termino =
            ref.d * ref.d - obsI.d * obsI.d +
            obsI.x * obsI.x - ref.x * ref.x +
            obsI.y * obsI.y - ref.y * ref.y;

        aa += coefX * coefX;
        ab += coefX * coefY;
        bb += coefY * coefY;
        ar += coefX * termino;
        br += coefY * termino;
    }

    const det = aa * bb - ab * ab;
    if (Math.abs(det) < DET_MINIMO) return null;

    return {
        x: (ar * bb - br * ab) / det,
        y: (aa * br - ab * ar) / det,
    };
};

/**
 * Resuelve la posición con solo dos observaciones.
 *
 * Dos circunferencias se cortan en dos puntos, uno a cada lado de la recta que
 * une los nodos. Se devuelve el punto medio de ambos —el pie de esa recta—
 * porque sin una tercera medida no hay forma de saber cuál de los dos es, y
 * elegir al azar introduciría un error mayor que quedarse en el centro.
 *
 * Cuando las circunferencias no llegan a cortarse, que con RSSI ruidoso ocurre
 * a menudo, se toma igualmente ese pie: es la posición más compatible con las
 * dos distancias, aunque ninguna se cumpla exactamente.
 *
 * @returns El punto, o `null` si los dos nodos comparten posición.
 */
const interseccion = (a: Observacion, b: Observacion): Punto | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const separacion = Math.hypot(dx, dy);

    if (separacion < DET_MINIMO) return null;

    // Distancia desde `a` al pie de la recta que une los dos puntos de corte.
    const avance = (a.d * a.d - b.d * b.d + separacion * separacion) / (2 * separacion);

    return {
        x: a.x + (avance * dx) / separacion,
        y: a.y + (avance * dy) / separacion,
    };
};

/** Comprueba que el punto caiga dentro de la zona, con el margen tolerado. */
const dentroDeLimites = (punto: Punto, limites: Limites): boolean =>
    punto.x >= -MARGEN_FUERA_M &&
    punto.y >= -MARGEN_FUERA_M &&
    punto.x <= limites.ancho + MARGEN_FUERA_M &&
    punto.y <= limites.alto + MARGEN_FUERA_M;

/**
 * Estima la posición de un dispositivo a partir de las observaciones de los
 * nodos que lo vieron.
 *
 * @param obs     - Una entrada por nodo que detectó al dispositivo.
 * @param limites - Rectángulo de la zona, para descartar imposibles.
 * @returns El punto estimado, o `null` si no hay datos suficientes o la
 *          solución cae fuera de la zona.
 */
const estimar = (obs: Observacion[], limites: Limites): Punto | null => {
    const punto =
        obs.length >= 3 ? trilaterar(obs) :
        obs.length === 2 ? interseccion(obs[0], obs[1]) :
        null;

    if (!punto) return null;
    return dentroDeLimites(punto, limites) ? punto : null;
};

/**
 * Sitúa dispositivos en el plano a partir de distancias a nodos conocidos.
 *
 * **Qué resuelve**: cada nodo aporta una circunferencia —el dispositivo está a
 * `d` metros de él, en alguna dirección—. Con dos circunferencias quedan dos
 * puntos posibles; con tres, uno solo. El servicio implementa ambos casos y
 * descarta lo que no se puede resolver.
 *
 * **Qué no resuelve**: la calidad del resultado depende por completo de la
 * calidad de `d`, que viene de aplicar el modelo de pérdida logarítmica al
 * RSSI. Con los parámetros sin calibrar, el error de cada distancia es de
 * varios metros y la posición hereda ese error. Sirve para ver dónde se
 * concentra la gente, no para señalar a nadie.
 *
 * El servicio es **puro**: no toca la base de datos ni el reloj, así que su
 * comportamiento se puede fijar por completo en pruebas.
 */
@singleton()
export class PositioningService {
    /**
     * Estima la posición de un dispositivo a partir de las observaciones de
     * los nodos que lo vieron.
     *
     * @param obs     - Una entrada por nodo que detectó al dispositivo.
     * @param limites - Rectángulo de la zona, para descartar imposibles.
     * @returns El punto estimado, o `null` si no hay datos suficientes o la
     *          solución cae fuera de la zona.
     */
    readonly estimar = estimar;
}
