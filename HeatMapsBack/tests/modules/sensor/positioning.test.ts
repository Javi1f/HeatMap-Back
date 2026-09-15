import { describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import {
    Limites,
    Observacion,
    PositioningService,
} from '../../../src/modules/sensor/services/positioning.service';

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

/** Construye las observaciones exactas de un dispositivo situado en `p`. */
const observar = (punto: { x: number; y: number }, nodos = [S1, S2, S3]): Observacion[] =>
    nodos.map((nodo) => ({ ...nodo, d: Math.hypot(punto.x - nodo.x, punto.y - nodo.y) }));

describe('PositioningService', () => {
    describe('con tres nodos y distancias exactas', () => {
        it.each([
            ['centro de la plaza', { x: 10.5, y: 5.92 }],
            ['junto al nodo 1', { x: 1, y: 1 }],
            ['junto al nodo 3', { x: 10.2, y: 11.2 }],
            ['esquina sin nodo', { x: 21, y: 11.84 }],
            ['borde inferior', { x: 12, y: 0.2 }],
        ])('sitúa el dispositivo en %s', (_caso, esperado) => {
            const punto = posicionador.estimar(observar(esperado), PLAZA);
            expect(punto).not.toBeNull();
            expect(punto?.x).toBeCloseTo(esperado.x, 6);
            expect(punto?.y).toBeCloseTo(esperado.y, 6);
        });
    });

    describe('con ruido en las distancias', () => {
        /**
         * Medio metro de error en cada distancia es optimista para un RSSI sin
         * calibrar; si con ese ruido la posición ya se desvía más de un metro,
         * el mapa no serviría ni para ver concentraciones.
         */
        it('mantiene el error acotado cuando las distancias se desvían', () => {
            const real = { x: 10.5, y: 5.92 };
            const ruido = [0.5, -0.4, 0.3];
            const obs = observar(real).map((observacion, i) => ({ ...observacion, d: observacion.d + ruido[i] }));

            const punto = posicionador.estimar(obs, PLAZA);
            expect(punto).not.toBeNull();
            expect(Math.hypot(punto?.x - real.x, punto?.y - real.y)).toBeLessThan(1.5);
        });
    });

    describe('con dos nodos', () => {
        it('devuelve un punto sobre la recta entre ambos cortes', () => {
            const real = { x: 4, y: 4.55 };
            const punto = posicionador.estimar(observar(real, [S1, S2]), PLAZA);

            expect(punto).not.toBeNull();
            // Los dos nodos comparten el borde inferior, así que sin una tercera
            // medida la altura no se puede recuperar; la componente X sí queda
            // determinada por las dos distancias.
            expect(punto?.x).toBeCloseTo(real.x, 6);
        });

        it('resuelve aunque las circunferencias no lleguen a cortarse', () => {
            const obs: Observacion[] = [
                { ...S1, d: 1 },
                { ...S2, d: 1 },
            ];
            const punto = posicionador.estimar(obs, PLAZA);
            expect(punto).not.toBeNull();
            expect(punto?.x).toBeCloseTo(10.5, 6);
        });
    });

    describe('casos que no se pueden resolver', () => {
        it('descarta un dispositivo visto por un solo nodo', () => {
            expect(posicionador.estimar([{ ...S1, d: 5 }], PLAZA)).toBeNull();
        });

        it('descarta cuando no hay observaciones', () => {
            expect(posicionador.estimar([], PLAZA)).toBeNull();
        });

        it('descarta si los nodos están alineados', () => {
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
        it('acepta una posición justo en el borde', () => {
            const punto = posicionador.estimar(observar({ x: 0, y: 0 }), PLAZA);
            expect(punto).not.toBeNull();
        });

        it('acepta un pequeño desbordamiento, que el ruido explica', () => {
            const punto = posicionador.estimar(observar({ x: -1, y: 4 }), PLAZA);
            expect(punto).not.toBeNull();
        });

        it('descarta una posición claramente fuera de la plaza', () => {
            const punto = posicionador.estimar(observar({ x: 40, y: 4 }), PLAZA);
            expect(punto).toBeNull();
        });
    });
});
