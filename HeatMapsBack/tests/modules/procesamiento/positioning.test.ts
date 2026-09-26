import { describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import {
    Limites,
    Observacion,
    PositioningService,
} from '../../../src/modules/procesamiento/positioning.service';

const posicionador = container.resolve(PositioningService);

/**
 * Geometría real de la plazoleta del despliegue: 21 m × 11,84 m.
 *
 * Los nodos forman un triángulo isósceles: dos en las esquinas inferiores y el
 * tercero en el centro del borde superior. A diferencia de montarlos en tres
 * esquinas, esta disposición es simétrica respecto al eje vertical, así que el
 * error de posición no favorece a ninguna mitad de la plaza.
 */
const PLAZA: Limites = { ancho: 21, alto: 11.84 };

/** Esquina inferior izquierda, origen de coordenadas. */
const S1 = { x: 0, y: 0 };
/** Esquina inferior derecha. */
const S2 = { x: 21, y: 0 };
/** Centro del borde superior. */
const S3 = { x: 10.5, y: 11.84 };

/** Exponente de atenuación calibrado, con el que se traducen los dB de error a distancia. */
const EXPONENTE = 2;

/**
 * Duda casi nula: el posicionador se queda prácticamente con el punto que mejor
 * explica las medidas. Sirve para comprobar la geometría del criterio aislada
 * del efecto de promediar.
 */
const SIN_DUDA = 0.02;

/**
 * Observaciones de un dispositivo situado en `punto`.
 *
 * @param escala - Factor por el que el modelo de propagación estira o encoge
 *                 todas las distancias, que es lo que ocurre cuando su nivel de
 *                 referencia no está calibrado o el aparato emite más o menos.
 * @param ruidoDb - Error de señal de cada nodo, en dB: positivo si llega más
 *                  débil de lo que toca, como cuando alguien tapa el enlace.
 */
const observar = (
    punto: { x: number; y: number },
    { nodos = [S1, S2, S3], escala = 1, ruidoDb = [0, 0, 0] } = {},
): Observacion[] =>
    nodos.map((nodo, indice) => ({
        ...nodo,
        d: escala * Math.hypot(punto.x - nodo.x, punto.y - nodo.y) * 10 ** ((ruidoDb[indice] ?? 0) / (10 * EXPONENTE)),
    }));

/** Distancia entre la posición estimada y la real, en metros. */
const desvio = (estimada: { x: number; y: number } | null, real: { x: number; y: number }): number =>
    Math.hypot((estimada?.x ?? NaN) - real.x, (estimada?.y ?? NaN) - real.y);

const PUNTOS: [string, { x: number; y: number }][] = [
    ['centro de la plaza', { x: 10.5, y: 5.92 }],
    ['junto al nodo 1', { x: 1, y: 1 }],
    ['junto al nodo 3', { x: 10.2, y: 11.2 }],
    ['borde inferior', { x: 12, y: 0.2 }],
    ['mitad superior izquierda', { x: 3, y: 9 }],
];

describe('PositioningService', () => {
    describe('el criterio de razones', () => {
        it.each(PUNTOS)('con medidas exactas, lo más compatible está en el sitio real: %s', (_caso, esperado) => {
            expect(desvio(posicionador.estimar(observar(esperado), PLAZA, SIN_DUDA), esperado)).toBeLessThan(0.8);
        });

        /*
         * Es el fallo que amontonaba el mapa en el centro: con las distancias
         * encogidas, la trilateración clásica devolvía el punto equidistante de
         * los tres nodos para todo el mundo. El criterio de razones no usa la
         * escala, así que la posición no se mueve. Tampoco la mueve la potencia
         * del aparato: un teléfono y un portátil en el mismo sitio caen igual.
         */
        it.each(PUNTOS)('no depende de la escala de las distancias: %s', (_caso, esperado) => {
            const calibrado = posicionador.estimar(observar(esperado), PLAZA);
            for (const escala of [0.4, 2.5]) {
                const otro = posicionador.estimar(observar(esperado, { escala }), PLAZA);
                expect(otro?.x).toBeCloseTo(calibrado?.x ?? NaN, 6);
                expect(otro?.y).toBeCloseTo(calibrado?.y ?? NaN, 6);
            }
        });

        it('informa del factor de escala, que es lo que permite recalibrar el modelo', () => {
            const punto = posicionador.estimar(observar({ x: 7, y: 4 }, { escala: 0.4 }), PLAZA, SIN_DUDA);
            expect(punto?.factorEscala).toBeCloseTo(0.4, 1);
            expect(punto?.dispersion).toBeCloseTo(1, 1);
        });

        /*
         * Con tres nodos siempre hay un punto que explica las tres medidas a la
         * vez, así que no sobra información con la que delatar el ruido. Un
         * cuarto nodo sí la aporta.
         */
        it('sólo delata medidas contradictorias a partir del cuarto nodo', () => {
            const cuarto = { x: 0, y: 11.84 };
            const conCuatro = observar({ x: 8, y: 6 }, { nodos: [S1, S2, S3, cuarto], ruidoDb: [8, -8, 6, -5] });
            expect(posicionador.estimar(conCuatro, PLAZA, SIN_DUDA)?.dispersion).toBeGreaterThan(1.2);
            expect(posicionador.estimar(observar({ x: 8, y: 6 }, { nodos: [S1, S2, S3, cuarto] }), PLAZA, SIN_DUDA)?.dispersion)
                .toBeCloseTo(1, 2);
        });
    });

    describe('con personas alrededor', () => {
        /*
         * Alguien entre el dispositivo y el nodo 3 le quita 10 dB a ese enlace.
         * El punto que mejor explica las tres señales salta entonces lejos —
         * justifica la caída alejándose del nodo 3—; la media de todos los
         * compatibles se mueve mucho menos.
         */
        it('un enlace tapado desplaza mucho menos la media que el punto más compatible', () => {
            const real = { x: 10.5, y: 5.92 };
            const tapado = observar(real, { ruidoDb: [0, 0, 10] });
            const media = desvio(posicionador.estimar(tapado, PLAZA), real);
            const maximo = desvio(posicionador.estimar(tapado, PLAZA, SIN_DUDA), real);
            expect(media).toBeLessThan(2.5);
            expect(maximo).toBeGreaterThan(2 * media);
        });

        it('mantiene el error en pocos metros con ±2 dB de desvío por enlace, que es el límite físico del RSSI', () => {
            const errores = PUNTOS.map(([, real]) =>
                desvio(posicionador.estimar(observar(real, { escala: 0.4, ruidoDb: [2, -2, 1] }), PLAZA), real));

            expect(errores.reduce((suma, error) => suma + error, 0) / errores.length).toBeLessThan(4);
            expect(Math.max(...errores)).toBeLessThan(7);
        });

        it('dice cuánto duda: poco junto a un nodo, mucho en medio de la plaza', () => {
            const junto = posicionador.estimar(observar({ x: 10.2, y: 11.2 }), PLAZA);
            const centro = posicionador.estimar(observar({ x: 10.5, y: 5.92 }), PLAZA);
            expect(junto?.incertidumbreM).toBeLessThan(2);
            expect(centro?.incertidumbreM).toBeGreaterThan(2 * (junto?.incertidumbreM ?? Infinity));
        });
    });

    describe('con dos nodos', () => {
        it('reparte la duda por el arco compatible y queda del lado del nodo más cercano', () => {
            const real = { x: 4, y: 4.55 };
            const dos = posicionador.estimar(observar(real, { nodos: [S1, S2] }), PLAZA);
            const tres = posicionador.estimar(observar(real), PLAZA);
            expect(dos?.x).toBeLessThan(PLAZA.ancho / 2);
            expect(desvio(dos, real)).toBeLessThan(3);
            expect(dos?.incertidumbreM).toBeGreaterThan(tres?.incertidumbreM ?? Infinity);
        });

        it('no se mueve aunque la escala del modelo esté mal', () => {
            const sinCalibrar = posicionador.estimar(observar({ x: 4, y: 4.55 }, { nodos: [S1, S2], escala: 0.4 }), PLAZA);
            const calibrado = posicionador.estimar(observar({ x: 4, y: 4.55 }, { nodos: [S1, S2] }), PLAZA);
            expect(sinCalibrar?.x).toBeCloseTo(calibrado?.x ?? NaN, 6);
        });

        it('resuelve aunque las circunferencias no lleguen a cortarse', () => {
            const obs: Observacion[] = [
                { ...S1, d: 1 },
                { ...S2, d: 1 },
            ];
            expect(posicionador.estimar(obs, PLAZA)?.x).toBeCloseTo(10.5, 6);
        });
    });

    describe('casos que no se pueden resolver', () => {
        it('descarta un dispositivo visto por un solo nodo', () => {
            expect(posicionador.estimar([{ ...S1, d: 5 }], PLAZA)).toBeNull();
        });

        it('descarta cuando no hay observaciones', () => {
            expect(posicionador.estimar([], PLAZA)).toBeNull();
        });

        it('descarta las distancias que el modelo no pudo calcular', () => {
            const obs: Observacion[] = [
                { ...S1, d: 5 },
                { ...S2, d: 0 },
                { ...S3, d: Number.NaN },
            ];
            expect(posicionador.estimar(obs, PLAZA)).toBeNull();
        });

        it('descarta si los nodos están alineados, porque no distinguen de qué lado está', () => {
            const alineados: Observacion[] = [
                { x: 0, y: 0, d: 5 },
                { x: 5, y: 0, d: 5 },
                { x: 10, y: 0, d: 5 },
            ];
            expect(posicionador.estimar(alineados, PLAZA)).toBeNull();
        });

        it('descarta dos nodos en la misma posición', () => {
            const solapados: Observacion[] = [
                { x: 3, y: 3, d: 2 },
                { x: 3, y: 3, d: 4 },
            ];
            expect(posicionador.estimar(solapados, PLAZA)).toBeNull();
        });
    });

    describe('límites de la zona', () => {
        it('nunca devuelve una posición fuera del espacio', () => {
            for (const fuera of [{ x: -8, y: 4 }, { x: 40, y: 4 }, { x: 10, y: 30 }]) {
                const punto = posicionador.estimar(observar(fuera), PLAZA);
                expect(punto?.x).toBeGreaterThanOrEqual(0);
                expect(punto?.x).toBeLessThanOrEqual(PLAZA.ancho);
                expect(punto?.y).toBeGreaterThanOrEqual(0);
                expect(punto?.y).toBeLessThanOrEqual(PLAZA.alto);
            }
        });

        /*
         * Sin escala fiable no se puede afirmar que un dispositivo esté fuera:
         * las mismas razones de distancias las cumple algún punto de dentro. De
         * descartar lo que viene de fuera se encarga el criterio de presencia
         * sobre la señal, que sí mira valores absolutos.
         */
        it('lo que viene de fuera cae del lado por el que llega, no en el centro', () => {
            expect(posicionador.estimar(observar({ x: -8, y: 4 }), PLAZA)?.x).toBeLessThan(7);
            expect(posicionador.estimar(observar({ x: 29, y: 4 }), PLAZA)?.x).toBeGreaterThan(14);
        });
    });
});
