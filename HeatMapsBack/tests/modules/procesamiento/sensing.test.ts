import { describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import { MacAnonymizerService } from '../../../src/modules/anonimizacion/mac-anonymizer.service';
import { DistanceEstimatorService } from '../../../src/modules/procesamiento/distance-estimator.service';

describe('MacAnonymizerService', () => {
    const anonymizer = container.resolve(MacAnonymizerService);

    it('produce un hash de 64 caracteres hex', () => {
        expect(anonymizer.hash('aa:bb:cc:dd:ee:ff')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('es determinista para la misma MAC', () => {
        expect(anonymizer.hash('aa:bb:cc:dd:ee:ff')).toBe(anonymizer.hash('aa:bb:cc:dd:ee:ff'));
    });

    it('normaliza mayúsculas y separadores', () => {
        const canonical = anonymizer.hash('aa:bb:cc:dd:ee:ff');
        expect(anonymizer.hash('AA:BB:CC:DD:EE:FF')).toBe(canonical);
        expect(anonymizer.hash('AA-BB-CC-DD-EE-FF')).toBe(canonical);
        expect(anonymizer.hash('aabbccddeeff')).toBe(canonical);
    });

    it('distingue MAC diferentes', () => {
        expect(anonymizer.hash('aa:bb:cc:dd:ee:ff')).not.toBe(anonymizer.hash('aa:bb:cc:dd:ee:fe'));
    });

    /**
     * El bit local es el segundo menos significativo del primer octeto:
     * `0x02` (`0b00000010`) es administrada localmente, `0x00` es universal
     * (asignada por el fabricante).
     */
    describe('detección del bit U/L', () => {
        it.each([
            ['02:00:00:00:00:01', true],
            ['06:11:22:33:44:55', true],
            ['0a:11:22:33:44:55', true],
            ['de:ad:be:ef:00:01', true],
            ['00:11:22:33:44:55', false],
            ['3c:22:fb:00:00:01', false],
            ['a4:83:e7:12:34:56', false],
        ])('%s → randomizada: %s', (mac, expected) => {
            expect(anonymizer.isRandomized(mac)).toBe(expected);
        });

        it('no falla con una MAC mal formada', () => {
            expect(anonymizer.isRandomized('no-es-una-mac')).toBe(false);
        });
    });
});

/**
 * Los casos parten de los valores por defecto del entorno de pruebas
 * (RSSI₀ = −40 dBm, n = 3,0), con los que el modelo se reduce a
 * `d = 10 ^ ((−40 − RSSI) / 30)`.
 */
describe('DistanceEstimatorService', () => {
    const estimator = container.resolve(DistanceEstimatorService);

    it('devuelve 1 metro al RSSI de referencia', () => {
        expect(estimator.estimate(-40)).toBeCloseTo(1, 2);
    });

    it('devuelve 10 metros a 30 dB por debajo de la referencia', () => {
        expect(estimator.estimate(-70)).toBeCloseTo(10, 1);
    });

    /**
     * Estima y falla con un mensaje útil si el RSSI no da distancia.
     *
     * Sustituye a la aserción de no nulidad: estrecha el tipo de verdad y, si
     * algún día deja de haber distancia, el fallo dice qué RSSI la provocó en
     * lugar de reventar comparando contra `null`.
     */
    const distanciaDe = (rssi: number): number => {
        const metros = estimator.estimate(rssi);
        if (metros === null) throw new Error(`RSSI ${rssi} no produjo distancia`);
        return metros;
    };

    it('crece de forma monótona al debilitarse la señal', () => {
        const cerca = distanciaDe(-45);
        const medio = distanciaDe(-60);
        const lejos = distanciaDe(-80);
        expect(cerca).toBeLessThan(medio);
        expect(medio).toBeLessThan(lejos);
    });

    it('estima por debajo de un metro con señal más fuerte que la referencia', () => {
        expect(distanciaDe(-25)).toBeLessThan(1);
    });

    it('descarta RSSI no utilizables', () => {
        expect(estimator.estimate(0)).toBeNull();
        expect(estimator.estimate(10)).toBeNull();
        expect(estimator.estimate(Number.NaN)).toBeNull();
    });

    it('acota la distancia al máximo plausible', () => {
        expect(estimator.estimate(-500)).toBe(999.99);
    });

    describe('desajusteDb', () => {
        it('no corrige nada si las distancias ya cuadran con la geometría', () => {
            expect(estimator.desajusteDb(1)).toBe(0);
        });

        /*
         * Con n = 3, duplicar la distancia son 9 dB: si el posicionador mide que
         * las distancias salen al doble de lo que exige la geometría, hay que
         * bajar 9 dB el nivel de referencia.
         */
        it('traduce el factor de escala a los dB que sobran en la referencia', () => {
            expect(estimator.desajusteDb(2)).toBeCloseTo(9, 1);
            expect(estimator.desajusteDb(0.5)).toBeCloseTo(-9, 1);
        });

        it('descarta factores que no son utilizables', () => {
            expect(estimator.desajusteDb(0)).toBeNull();
            expect(estimator.desajusteDb(-1)).toBeNull();
            expect(estimator.desajusteDb(Number.NaN)).toBeNull();
        });
    });
});
