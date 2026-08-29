import { describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import {
    Limites,
    Observacion,
    PositioningService,
} from '../../../src/modules/sensor/services/positioning.service';

const posicionador = container.resolve(PositioningService);

/**
 * Geometría real de la plazoleta del despliegue: 17,64 m × 9,10 m con los tres
 * nodos en tres de sus esquinas.
 */
const PLAZA: Limites = { ancho: 17.64, alto: 9.10 };

const S1 = { x: 0, y: 0 };
const S2 = { x: 0, y: 9.10 };
const S3 = { x: 17.64, y: 9.10 };

/** Construye las observaciones exactas de un dispositivo situado en `p`. */
const observar = (p: { x: number; y: number }, nodos = [S1, S2, S3]): Observacion[] =>
    nodos.map((s) => ({ ...s, d: Math.hypot(p.x - s.x, p.y - s.y) }));

describe('PositioningService', () => {
    describe('con tres nodos y distancias exactas', () => {
        it.each([
            ['centro de la plaza', { x: 8.82, y: 4.55 }],
            ['junto al nodo 1', { x: 1, y: 1 }],
            ['junto al nodo 3', { x: 16.5, y: 8.5 }],
            ['esquina sin nodo', { x: 17.64, y: 0 }],
            ['borde inferior', { x: 12, y: 0.2 }],
        ])('sitúa el dispositivo en %s', (_caso, esperado) => {
            const p = posicionador.estimar(observar(esperado), PLAZA);
            expect(p).not.toBeNull();
            expect(p!.x).toBeCloseTo(esperado.x, 6);
            expect(p!.y).toBeCloseTo(esperado.y, 6);
        });
    });

    describe('con ruido en las distancias', () => {
        /**
         * Medio metro de error en cada distancia es optimista para un RSSI sin
         * calibrar; si con ese ruido la posición ya se desvía más de un metro,
         * el mapa no serviría ni para ver concentraciones.
         */
        it('mantiene el error acotado cuando las distancias se desvían', () => {
            const real = { x: 8.82, y: 4.55 };
            const ruido = [0.5, -0.4, 0.3];
            const obs = observar(real).map((o, i) => ({ ...o, d: o.d + ruido[i] }));

            const p = posicionador.estimar(obs, PLAZA);
            expect(p).not.toBeNull();
            expect(Math.hypot(p!.x - real.x, p!.y - real.y)).toBeLessThan(1.5);
        });
    });

    describe('con dos nodos', () => {
        it('devuelve un punto sobre la recta entre ambos cortes', () => {
            const real = { x: 4, y: 4.55 };
            const p = posicionador.estimar(observar(real, [S1, S2]), PLAZA);

            expect(p).not.toBeNull();
            // Sin tercera medida la componente X no se puede recuperar, pero la
            // altura sí queda determinada por las dos distancias.
            expect(p!.y).toBeCloseTo(real.y, 6);
        });

        it('resuelve aunque las circunferencias no lleguen a cortarse', () => {
            const obs: Observacion[] = [
                { ...S1, d: 1 },
                { ...S2, d: 1 },
            ];
            const p = posicionador.estimar(obs, PLAZA);
            expect(p).not.toBeNull();
            expect(p!.y).toBeCloseTo(4.55, 6);
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
            const p = posicionador.estimar(observar({ x: 0, y: 0 }), PLAZA);
            expect(p).not.toBeNull();
        });

        it('acepta un pequeño desbordamiento, que el ruido explica', () => {
            const p = posicionador.estimar(observar({ x: -1, y: 4 }), PLAZA);
            expect(p).not.toBeNull();
        });

        it('descarta una posición claramente fuera de la plaza', () => {
            const p = posicionador.estimar(observar({ x: 40, y: 4 }), PLAZA);
            expect(p).toBeNull();
        });
    });
});
