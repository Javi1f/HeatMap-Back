import { describe, expect, it } from 'vitest';
import { envSchema } from '../../../src/common/env/env.schema';

const jwtExpiresIn = envSchema.shape.JWT_EXPIRES_IN;

/**
 * Lo que el esquema recibe cuando la variable no está en el entorno.
 *
 * Se nombra en lugar de pasar `undefined` en la llamada porque es el caso bajo
 * prueba —el despliegue que no configura nada— y no un hueco por rellenar.
 */
const SIN_DEFINIR: string | undefined = undefined;

/**
 * La duración de la sesión es una decisión de seguridad, no de comodidad: el
 * sistema maneja datos de presencia, así que una sesión olvidada en un equipo
 * compartido es el riesgo que acota el tope de una hora.
 *
 * Se comprueba aquí porque el valor llega de una variable de entorno, que no
 * pasa por revisión de código: sin esta validación, un despliegue podría subir
 * el tope sin que nadie lo notara.
 */
describe('JWT_EXPIRES_IN', () => {
    it('dura una hora si no se configura', () => {
        expect(jwtExpiresIn.parse(SIN_DEFINIR)).toBe('1h');
    });

    it('admite duraciones de una hora o menos', () => {
        for (const valor of ['1h', '60m', '3600', '45m', '30s']) {
            expect(jwtExpiresIn.parse(valor)).toBe(valor);
        }
    });

    it('rechaza cualquier duración superior a una hora', () => {
        for (const valor of ['24h', '2h', '61m', '3601', '7d']) {
            expect(() => jwtExpiresIn.parse(valor)).toThrow();
        }
    });

    it('rechaza texto que no expresa una duración', () => {
        for (const valor of ['', 'una hora', '1 semana', 'abc']) {
            expect(() => jwtExpiresIn.parse(valor)).toThrow();
        }
    });
});

describe('Conversión de variables numéricas y booleanas', () => {
    const exponente = envSchema.shape.PATH_LOSS_EXPONENT;
    const sincronizar = envSchema.shape.DB_SYNCHRONIZE;

    it('los decimales llegan como texto y se convierten, con valor por defecto si faltan', () => {
        expect(exponente.parse('2.7')).toBe(2.7);
        expect(exponente.parse(SIN_DEFINIR)).toBe(3);
        expect(exponente.parse(2.5)).toBe(2.5);
        expect(() => exponente.parse('')).toThrow();
        expect(() => exponente.parse('mucho')).toThrow();
    });

    it('los booleanos sólo son verdaderos con «true», sin distinguir mayúsculas', () => {
        expect(sincronizar.parse('TRUE')).toBe(true);
        expect(sincronizar.parse('false')).toBe(false);
        expect(sincronizar.parse('sí')).toBe(false);
        expect(sincronizar.parse(true)).toBe(true);
        expect(sincronizar.parse(SIN_DEFINIR)).toBe(false);
    });
});
