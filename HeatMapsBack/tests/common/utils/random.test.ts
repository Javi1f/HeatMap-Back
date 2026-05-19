import { describe, expect, it } from 'vitest';
import { generateNumericCode } from '../../../src/common/utils/random';

describe('generateNumericCode', () => {
    it('respeta la cantidad de dígitos solicitada (con padding)', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateNumericCode(5);
            expect(code).toMatch(/^\d{5}$/);
        }
    });

    it('rechaza valores fuera del rango permitido', () => {
        expect(() => generateNumericCode(0)).toThrow(RangeError);
        expect(() => generateNumericCode(13)).toThrow(RangeError);
    });

    it('genera valores distintos (no es determinista)', () => {
        const samples = new Set<string>();
        for (let i = 0; i < 50; i++) samples.add(generateNumericCode(6));
        // Con 6 dígitos y 50 muestras es prácticamente imposible que todas coincidan.
        expect(samples.size).toBeGreaterThan(1);
    });
});
