import { describe, expect, it, vi } from 'vitest';
import { crearCacheTemporal } from '../../../src/common/utils/cache-temporal';

describe('crearCacheTemporal', () => {
    it('reutiliza el valor mientras no caduca', async () => {
        let reloj = 0;
        const cache = crearCacheTemporal<number>(3000, () => reloj);
        const calcular = vi.fn(() => Promise.resolve(42));

        await cache.obtener('a', calcular);
        reloj = 2999;
        await cache.obtener('a', calcular);

        expect(calcular).toHaveBeenCalledTimes(1);
    });

    it('recalcula al caducar', async () => {
        let reloj = 0;
        const cache = crearCacheTemporal<number>(3000, () => reloj);
        const calcular = vi.fn(() => Promise.resolve(42));

        await cache.obtener('a', calcular);
        reloj = 3000;
        await cache.obtener('a', calcular);

        expect(calcular).toHaveBeenCalledTimes(2);
    });

    it('comparte la consulta en curso entre peticiones simultáneas', async () => {
        const cache = crearCacheTemporal<number>(3000);
        const calcular = vi.fn(() => new Promise<number>((resolver) => {
            setTimeout(() => resolver(7), 10);
        }));

        const valores = await Promise.all([cache.obtener('a', calcular), cache.obtener('a', calcular)]);

        expect(valores).toEqual([7, 7]);
        expect(calcular).toHaveBeenCalledTimes(1);
    });

    it('no guarda un fallo: la siguiente petición reintenta', async () => {
        const cache = crearCacheTemporal<number>(3000);
        const fallo = vi.fn(() => Promise.reject(new Error('caída')));

        await expect(cache.obtener('a', fallo)).rejects.toThrow('caída');
        await Promise.resolve();

        const exito = vi.fn(() => Promise.resolve(1));
        await expect(cache.obtener('a', exito)).resolves.toBe(1);
    });

    it('se vacía al llegar a 500 entradas para no crecer sin límite', async () => {
        const cache = crearCacheTemporal<number>(60_000);
        const primera = vi.fn(() => Promise.resolve(0));
        await cache.obtener('clave-0', primera);
        await Promise.all(Array.from({ length: 499 }, (_valor, i) => cache.obtener(`clave-${i + 1}`, () => Promise.resolve(i + 1))));

        await cache.obtener('clave-500', () => Promise.resolve(500));
        await cache.obtener('clave-0', primera);

        expect(primera).toHaveBeenCalledTimes(2);
    });

    it('separa las claves', async () => {
        const cache = crearCacheTemporal<string>(3000);
        await expect(cache.obtener('a', () => Promise.resolve('A'))).resolves.toBe('A');
        await expect(cache.obtener('b', () => Promise.resolve('B'))).resolves.toBe('B');
    });
});
