import { describe, expect, it } from 'vitest';
import { aCsv } from '../../../src/modules/reportes/reportes.service';

describe('aCsv', () => {
    it('entrecomilla todos los valores', () => {
        expect(aCsv(['Plazoleta', 3])).toBe('"Plazoleta","3"');
    });

    it('conserva las comas dentro de un campo', () => {
        // Sin entrecomillar, esta fila se abriria como tres columnas.
        expect(aCsv(['Ocupación alta: 19 dispositivos, aforo 20'])).toBe(
            '"Ocupación alta: 19 dispositivos, aforo 20"',
        );
    });

    it('duplica las comillas internas', () => {
        expect(aCsv(['Zona "Norte"'])).toBe('"Zona ""Norte"""');
    });

    it('conserva los saltos de línea dentro del campo', () => {
        expect(aCsv(['linea1\nlinea2'])).toBe('"linea1\nlinea2"');
    });

    it('serializa los números como texto entrecomillado', () => {
        expect(aCsv([13.67, -58, 0])).toBe('"13.67","-58","0"');
    });

    it('devuelve cadena vacía entrecomillada para un valor vacío', () => {
        expect(aCsv([''])).toBe('""');
    });

    it('produce una línea vacía si no hay valores', () => {
        expect(aCsv([])).toBe('');
    });
});
