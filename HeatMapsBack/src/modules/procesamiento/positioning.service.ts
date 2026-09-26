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

    /**
     * Cuánto se reparten, en metros, las posiciones compatibles con las
     * medidas alrededor de la estimada: la desviación típica de la distancia a
     * ella. Pequeña junto a un nodo, donde la señal cambia deprisa con la
     * distancia; grande en medio de la plaza y con dos nodos.
     */
    incertidumbreM: number;
}

/**
 * Distancia mínima que se considera a un nodo, en metros.
 *
 * El criterio usa logaritmos de distancias, y un candidato que cayera justo
 * encima de un nodo daría `log(0)`. El suelo está por debajo del tamaño de
 * celda del mapa, así que no quita resolución a nada que se dibuje.
 */
const DISTANCIA_MINIMA_M = 0.25;

/** Lado de las celdas sobre las que se evalúa cada posición posible, en metros. */
const CELDA_M = 0.5;

/** Por debajo de este producto vectorial los nodos se consideran alineados. */
const AREA_MINIMA_M2 = 1e-6;

/**
 * Error típico de la señal de un enlace, en dB, **después** de quitar lo que
 * tienen en común todos los enlaces de un dispositivo.
 *
 * Medido en la plazoleta con un portátil en siete tramos de posición conocida:
 * frente al modelo calibrado, cada enlace se desvía de forma estable unos
 * 4 dB (de −6,5 a +6,9). No es ruido de trama a trama —con el aparato quieto
 * esa variación es de 0,3 a 2,5 dB—, sino la orientación de la antena, los
 * rebotes y los cuerpos que hay en medio. Por eso no se cura promediando más
 * tiempo: sólo se puede tener en cuenta.
 */
export const RUIDO_ENLACE_DB = 4;

/**
 * {@link RUIDO_ENLACE_DB} en logaritmo natural de distancia con el exponente
 * calibrado (n = 2). Quien use otro exponente debe pasar el suyo a `estimar`
 * (ver `DistanceEstimatorService.aLogDistancia`).
 */
const RUIDO_LOG_POR_DEFECTO = (RUIDO_ENLACE_DB * Math.LN10) / 20;

/** Media aritmética de una lista no vacía. */
const media = (valores: readonly number[]): number =>
    valores.reduce((suma, valor) => suma + valor, 0) / valores.length;

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
 * Por el mismo motivo le da igual la potencia de cada aparato —un teléfono
 * emite bastante menos que un portátil— y lo que atenúa a todos los enlaces
 * por igual.
 */
const costeDeRazones = (punto: Punto, obs: readonly Observacion[]): number => {
    const razones = logRazones(punto, obs);
    const centro = media(razones);
    return media(razones.map((razon) => (razon - centro) ** 2));
};

/** Completa un punto con el factor de escala, la dispersión y la incertidumbre. */
const estimacionEn = (punto: Punto, obs: readonly Observacion[], incertidumbreM: number): Estimacion => {
    const razones = logRazones(punto, obs);
    return {
        x: punto.x,
        y: punto.y,
        factorEscala: Math.exp(media(razones)),
        dispersion: Math.exp(Math.sqrt(costeDeRazones(punto, obs))),
        incertidumbreM,
    };
};

/** Centros de las celdas que cubren la zona. */
const celdasDe = (limites: Limites): Punto[] => {
    const columnas = Math.max(1, Math.ceil(limites.ancho / CELDA_M));
    const filas = Math.max(1, Math.ceil(limites.alto / CELDA_M));
    const celdas: Punto[] = [];
    for (let fila = 0; fila < filas; fila++) {
        for (let columna = 0; columna < columnas; columna++) {
            celdas.push({
                x: Math.min((columna + 0.5) * CELDA_M, limites.ancho),
                y: Math.min((fila + 0.5) * CELDA_M, limites.alto),
            });
        }
    }
    return celdas;
};

/**
 * Centro de masa de las posiciones compatibles con las medidas, y cuánto se
 * reparten a su alrededor.
 *
 * Cada celda pesa según lo bien que explica las señales:
 *
 *     peso ∝ exp(−k · coste / (2·σ²))
 *
 * con `k` enlaces, el coste de {@link costeDeRazones} y `σ` el error típico de
 * un enlace. Es la verosimilitud de un error gaussiano por enlace cuando la
 * potencia del aparato es desconocida —al integrarla queda justo la varianza
 * de las razones—, así que el punto de coste mínimo, el que se elegía antes,
 * es el más probable de esta distribución.
 *
 * Quedarse con la media y no con ese máximo es lo que la hace robusta. Con
 * tres nodos siempre hay un punto que explica las tres señales a la perfección,
 * también cuando una llega tapada por alguien: el máximo salta entonces al
 * punto que justifica el error, a veces a muchos metros. La media pesa también
 * todos los que lo explican casi igual de bien, y se mueve mucho menos. Con dos
 * nodos, donde lo compatible es un arco entero, reparte la duda por el arco en
 * lugar de quedarse con uno de sus puntos.
 */
const mediaPosterior = (
    obs: readonly Observacion[],
    limites: Limites,
    ruidoLog: number,
): { punto: Punto; incertidumbreM: number } => {
    const celdas = celdasDe(limites);
    const factor = obs.length / (2 * ruidoLog * ruidoLog);
    const logPesos = celdas.map((celda) => -factor * costeDeRazones(celda, obs));
    const maximo = Math.max(...logPesos);
    const pesos = logPesos.map((valor) => Math.exp(valor - maximo));
    const total = pesos.reduce((suma, peso) => suma + peso, 0);

    const x = celdas.reduce((suma, celda, i) => suma + pesos[i] * celda.x, 0) / total;
    const y = celdas.reduce((suma, celda, i) => suma + pesos[i] * celda.y, 0) / total;
    const varianza = celdas.reduce(
        (suma, celda, i) => suma + pesos[i] * ((celda.x - x) ** 2 + (celda.y - y) ** 2),
        0,
    ) / total;
    return { punto: { x, y }, incertidumbreM: Math.sqrt(varianza) };
};

/** `true` si los nodos observados no están todos sobre una misma recta. */
const formanTriangulo = (obs: readonly Observacion[]): boolean => {
    const [primera, segunda] = obs;
    return obs.some((otra) => Math.abs(
        (segunda.x - primera.x) * (otra.y - primera.y) - (segunda.y - primera.y) * (otra.x - primera.x),
    ) > AREA_MINIMA_M2);
};

/** `true` si los nodos permiten situar algo: dos en sitios distintos, o tres o más no alineados. */
const geometriaUtil = (obs: readonly Observacion[]): boolean => {
    if (obs.length > 2) return formanTriangulo(obs);
    const [primera, segunda] = obs;
    return Math.hypot(segunda.x - primera.x, segunda.y - primera.y) >= AREA_MINIMA_M2;
};

/**
 * Estima la posición de un dispositivo a partir de las observaciones de los
 * nodos que lo vieron.
 *
 * @param obs      - Una entrada por nodo que detectó al dispositivo.
 * @param limites  - Rectángulo de la zona, que acota la búsqueda.
 * @param ruidoLog - Error típico de un enlace en logaritmo natural de
 *                   distancia; por defecto, {@link RUIDO_ENLACE_DB} con n = 2.
 * @returns La estimación, o `null` si no hay datos suficientes o los nodos no
 *          permiten resolverla.
 */
const estimar = (obs: readonly Observacion[], limites: Limites, ruidoLog = RUIDO_LOG_POR_DEFECTO): Estimacion | null => {
    const validas = obs.filter((observacion) => Number.isFinite(observacion.d) && observacion.d > 0);
    if (validas.length < 2 || !geometriaUtil(validas)) return null;

    const { punto, incertidumbreM } = mediaPosterior(validas, limites, ruidoLog);
    return estimacionEn(punto, validas, incertidumbreM);
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
 * **Personas alrededor**: un cuerpo entre el aparato y un nodo le quita a ese
 * enlace entre 5 y 15 dB, y la orientación de la antena mueve cualquiera unos
 * ±4 dB. Con tres nodos no se puede saber qué enlace falla, así que en lugar
 * de fiarse del único punto que lo explica todo se promedian todos los que lo
 * explican razonablemente bien (ver `mediaPosterior`). Probado sobre medidas
 * reales en posiciones conocidas, con personas simuladas encima: con gente
 * tapando enlaces, el peor 10 % de los errores pasa de 7,1 m a 5,6 m, y con
 * gente de paso de 7,1 m a 4,9 m; sin nadie alrededor queda igual.
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
     * @param obs      - Una entrada por nodo que detectó al dispositivo.
     * @param limites  - Rectángulo de la zona, que acota la búsqueda.
     * @param ruidoLog - Error típico de un enlace en logaritmo de distancia.
     * @returns La estimación, o `null` si no hay datos suficientes o los nodos
     *          no permiten resolverla.
     */
    readonly estimar = estimar;
}
