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

/** Posición estimada de un dispositivo, junto con lo que el ajuste dice de las medidas. */
export interface Estimacion extends Punto {
    /**
     * Cuántas veces mayores son las distancias medidas que las que exige la
     * geometría de la solución.
     *
     * Es la media geométrica de `medida / real` en el punto elegido. Vale 1
     * cuando el modelo de propagación está calibrado; por encima o por debajo
     * mide el desajuste del nivel de referencia, así que sirve para
     * recalibrarlo con los propios datos en lugar de a tanteo.
     */
    factorEscala: number;

    /**
     * Cuánto se contradicen las medidas entre sí, en veces.
     *
     * 1 significa que las distancias son exactamente proporcionales a las
     * reales; 1,5 que cada una se desvía alrededor de un 50 % del factor común.
     *
     * **Con tres nodos vale siempre 1**, y no es un error: tres medidas para
     * tres incógnitas —las dos coordenadas y la escala— siempre tienen solución
     * exacta, así que no sobra información con la que detectar contradicciones.
     * Sólo informa a partir del cuarto nodo.
     */
    dispersion: number;
}

/**
 * Distancia mínima que se considera a un nodo, en metros.
 *
 * El criterio usa logaritmos de distancias, y un candidato que cayera justo
 * encima de un nodo daría `log(0)`. El suelo está por debajo del tamaño de
 * celda del mapa, así que no quita resolución a nada que se dibuje.
 */
const DISTANCIA_MINIMA_M = 0.25;

/** Paso de la exploración inicial sobre el plano, en metros. */
const PASO_INICIAL_M = 0.5;

/** Factor por el que se encoge el paso cuando ningún vecino mejora. */
const REDUCCION_DEL_PASO = 0.4;

/** Paso por debajo del cual el refinado termina, en metros. */
const PASO_MINIMO_M = 1e-7;

/** Tope de desplazamientos del refinado, para que el bucle no dependa del dato. */
const MOVIMIENTOS_MAXIMOS = 2000;

/** Por debajo de este producto vectorial los nodos se consideran alineados. */
const AREA_MINIMA_M2 = 1e-6;

/** Las ocho direcciones en que el refinado prueba a moverse. */
const DESPLAZAMIENTOS: readonly (readonly [number, number])[] = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Media aritmética de una lista no vacía. */
const media = (valores: readonly number[]): number =>
    valores.reduce((suma, valor) => suma + valor, 0) / valores.length;

/** Restringe un valor al rango indicado, ambos extremos incluidos. */
const acotar = (valor: number, min: number, max: number): number => Math.min(Math.max(valor, min), max);

/** Distancia geométrica del candidato al nodo, con el suelo que evita el logaritmo de cero. */
const distanciaA = (punto: Punto, obs: Observacion): number =>
    Math.max(Math.hypot(punto.x - obs.x, punto.y - obs.y), DISTANCIA_MINIMA_M);

/** Logaritmo de la razón entre la distancia medida y la que exige el candidato, por nodo. */
const logRazones = (punto: Punto, obs: readonly Observacion[]): number[] =>
    obs.map((observacion) => Math.log(observacion.d / distanciaA(punto, observacion)));

/**
 * Coste de un candidato: varianza de los logaritmos de las razones.
 *
 * Vale 0 cuando todas las distancias medidas son proporcionales a las reales
 * **con un mismo factor, sea el que sea**. Ese detalle es el que hace al ajuste
 * inmune al nivel de referencia del modelo de propagación: si está mal, todas
 * las distancias se escalan igual, el coste no cambia y la posición tampoco.
 */
const costeDeRazones = (punto: Punto, obs: readonly Observacion[]): number => {
    const razones = logRazones(punto, obs);
    const centro = media(razones);
    return media(razones.map((razon) => (razon - centro) ** 2));
};

/** Completa un punto con el factor de escala y la dispersión que le corresponden. */
const estimacionEn = (punto: Punto, obs: readonly Observacion[]): Estimacion => {
    const razones = logRazones(punto, obs);
    return {
        x: punto.x,
        y: punto.y,
        factorEscala: Math.exp(media(razones)),
        dispersion: Math.exp(Math.sqrt(costeDeRazones(punto, obs))),
    };
};

/** Punto de la rejilla gruesa con menor coste, del que arranca el refinado. */
const exploracionGruesa = (obs: readonly Observacion[], limites: Limites): Punto => {
    const columnas = Math.ceil(limites.ancho / PASO_INICIAL_M);
    const filas = Math.ceil(limites.alto / PASO_INICIAL_M);
    let mejor: Punto = { x: 0, y: 0 };
    let menor = Infinity;

    for (let columna = 0; columna <= columnas; columna++) {
        for (let fila = 0; fila <= filas; fila++) {
            const punto = {
                x: Math.min(columna * PASO_INICIAL_M, limites.ancho),
                y: Math.min(fila * PASO_INICIAL_M, limites.alto),
            };
            const valor = costeDeRazones(punto, obs);
            if (valor < menor) {
                menor = valor;
                mejor = punto;
            }
        }
    }
    return mejor;
};

/** Candidato vecino que mejora el coste, o `null` si ninguno lo hace. */
const mejorVecino = (
    punto: Punto,
    obs: readonly Observacion[],
    limites: Limites,
    paso: number,
    referencia: number,
): { punto: Punto; valor: number } | null => {
    let mejor: { punto: Punto; valor: number } | null = null;
    let menor = referencia;

    for (const [avanceX, avanceY] of DESPLAZAMIENTOS) {
        const vecino = {
            x: acotar(punto.x + avanceX * paso, 0, limites.ancho),
            y: acotar(punto.y + avanceY * paso, 0, limites.alto),
        };
        const valor = costeDeRazones(vecino, obs);
        if (valor < menor) {
            menor = valor;
            mejor = { punto: vecino, valor };
        }
    }
    return mejor;
};

/**
 * Búsqueda de patrón: se mueve al vecino que mejora y encoge el paso cuando
 * ninguno lo hace.
 *
 * Se refina sobre la rejilla gruesa en lugar de resolver un sistema porque el
 * criterio de razones no tiene forma cerrada, y porque una búsqueda acotada al
 * rectángulo no puede devolver un punto imposible.
 */
const refinar = (inicio: Punto, obs: readonly Observacion[], limites: Limites): Punto => {
    let punto = inicio;
    let valor = costeDeRazones(punto, obs);
    let paso = PASO_INICIAL_M;
    let movimientos = 0;

    while (paso > PASO_MINIMO_M && movimientos < MOVIMIENTOS_MAXIMOS) {
        const vecino = mejorVecino(punto, obs, limites, paso, valor);
        if (vecino) {
            punto = vecino.punto;
            valor = vecino.valor;
            movimientos++;
        } else {
            paso *= REDUCCION_DEL_PASO;
        }
    }
    return punto;
};

/** `true` si los nodos observados no están todos sobre una misma recta. */
const formanTriangulo = (obs: readonly Observacion[]): boolean => {
    const [primera, segunda] = obs;
    return obs.some((otra) => Math.abs(
        (segunda.x - primera.x) * (otra.y - primera.y) - (segunda.y - primera.y) * (otra.x - primera.x),
    ) > AREA_MINIMA_M2);
};

/**
 * Resuelve la posición con solo dos observaciones.
 *
 * De dos distancias sin escala fiable solo se puede aprovechar su razón, y el
 * lugar geométrico de los puntos que la cumplen es una circunferencia entera:
 * ninguno de sus puntos es mejor que otro. Se devuelve el que cae sobre la
 * recta que une los nodos, el único que no elige una dirección al azar.
 *
 * @returns El punto, o `null` si los dos nodos comparten posición.
 */
const porRazonDeDistancias = (primera: Observacion, segunda: Observacion): Punto | null => {
    const avanceX = segunda.x - primera.x;
    const avanceY = segunda.y - primera.y;
    if (Math.hypot(avanceX, avanceY) < AREA_MINIMA_M2) return null;

    const fraccion = primera.d / (primera.d + segunda.d);
    return {
        x: primera.x + avanceX * fraccion,
        y: primera.y + avanceY * fraccion,
    };
};

/** Estimación con dos nodos, ya completada con escala y dispersión. */
const conDosNodos = (obs: readonly Observacion[]): Estimacion | null => {
    const punto = porRazonDeDistancias(obs[0], obs[1]);
    return punto ? estimacionEn(punto, obs) : null;
};

/**
 * Estima la posición de un dispositivo a partir de las observaciones de los
 * nodos que lo vieron.
 *
 * @param obs     - Una entrada por nodo que detectó al dispositivo.
 * @param limites - Rectángulo de la zona, que acota la búsqueda.
 * @returns La estimación, o `null` si no hay datos suficientes o los nodos no
 *          permiten resolverla.
 */
const estimar = (obs: readonly Observacion[], limites: Limites): Estimacion | null => {
    const validas = obs.filter((observacion) => Number.isFinite(observacion.d) && observacion.d > 0);

    if (validas.length < 2) return null;
    if (validas.length === 2) return conDosNodos(validas);
    if (!formanTriangulo(validas)) return null;

    return estimacionEn(refinar(exploracionGruesa(validas, limites), validas, limites), validas);
};

/**
 * Sitúa dispositivos en el plano a partir de distancias a nodos conocidos.
 *
 * **Qué resuelve**: busca el punto del espacio cuyas distancias a los nodos son
 * las más proporcionales a las medidas. Ajusta la **forma** de las medidas y no
 * su tamaño: el factor común entre distancia medida y distancia real se estima
 * aparte en lugar de darlo por bueno.
 *
 * **Por qué no por trilateración clásica**: linealizar las circunferencias deja
 * un sistema en las *diferencias de distancias al cuadrado*. Si el modelo de
 * propagación devuelve distancias demasiado cortas —lo que ocurre en cuanto el
 * nivel de referencia o el exponente no están calibrados—, esas diferencias se
 * encogen todas y la solución converge al punto equidistante de los tres nodos:
 * el mapa amontona a todo el mundo en el centro aunque las señales sean
 * correctas. Ajustar solo razones elimina ese sesgo de raíz, porque un error de
 * escala común desaparece del criterio.
 *
 * **Qué no resuelve**: la posición sigue heredando el ruido del RSSI, y sin
 * escala fiable no puede afirmar que un dispositivo esté fuera del espacio; de
 * eso se encarga el criterio de presencia sobre la señal. Sirve para ver dónde
 * se concentra la gente, no para señalar a nadie.
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
     * @param limites - Rectángulo de la zona, que acota la búsqueda.
     * @returns La estimación, o `null` si no hay datos suficientes o los nodos
     *          no permiten resolverla.
     */
    readonly estimar = estimar;
}
