import { describe, expect, it } from 'vitest';
import { envSchema } from '../../../src/common/env/env.schema';

const jwtExpiresIn = envSchema.shape.JWT_EXPIRES_IN;

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
        expect(jwtExpiresIn.parse(undefined)).toBe('1h');
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
