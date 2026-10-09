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

    /*
     * Defecto hallado en la prueba de carga (CP-21): el mapa tarda más en
     * calcularse que la vida de la caché, y como esa vida se contaba desde el
     * inicio, el resultado llegaba ya caducado y cada petición recalculaba.
     */
    it('un cálculo más lento que la vida de la caché sigue sirviendo a quien llega mientras dura y después', async () => {
        let reloj = 0;
        const cache = crearCacheTemporal<number>(1000, () => reloj);
        /** Termina el cálculo en curso; la asigna la promesa al crearse. */
        let terminar!: (valor: number) => void;
        const calcular = vi.fn(() => new Promise<number>((resolver) => {
            terminar = resolver;
        }));

        const primera = cache.obtener('mapa', calcular);
        reloj = 2800;
        const durante = cache.obtener('mapa', calcular);
        terminar(5);
        await expect(Promise.all([primera, durante])).resolves.toEqual([5, 5]);

        reloj = 3500;
        await cache.obtener('mapa', calcular);
        expect(calcular).toHaveBeenCalledTimes(1);

        reloj = 3800;
        await cache.obtener('mapa', () => Promise.resolve(6));
        expect(await cache.obtener('mapa', calcular)).toBe(6);
    });

    describe('sirviendo lo caducado mientras recalcula', () => {
        /** Promesa que se resuelve o rechaza desde fuera. */
        const diferida = <T>() => {
            let resolver!: (valor: T) => void;
            let rechazar!: (error: Error) => void;
            const promesa = new Promise<T>((ok, ko) => {
                resolver = ok;
                rechazar = ko;
            });
            return { promesa, resolver, rechazar };
        };

        it('dentro del margen devuelve el valor anterior al instante y recalcula una sola vez', async () => {
            let reloj = 0;
            const cache = crearCacheTemporal<number>(1000, () => reloj, 15_000);
            await cache.obtener('mapa', () => Promise.resolve(1));

            reloj = 2000;
            const siguiente = diferida<number>();
            const calcular = vi.fn(() => siguiente.promesa);
            await expect(cache.obtener('mapa', calcular)).resolves.toBe(1);
            await expect(cache.obtener('mapa', calcular)).resolves.toBe(1);
            expect(calcular).toHaveBeenCalledOnce();

            siguiente.resolver(2);
            await siguiente.promesa;
            await expect(cache.obtener('mapa', calcular)).resolves.toBe(2);
        });

        it('pasado el margen ya no sirve lo viejo: espera al cálculo', async () => {
            let reloj = 0;
            const cache = crearCacheTemporal<number>(1000, () => reloj, 15_000);
            await cache.obtener('mapa', () => Promise.resolve(1));

            reloj = 1000 + 15_001;
            await expect(cache.obtener('mapa', () => Promise.resolve(3))).resolves.toBe(3);
        });

        it('si el recálculo falla, conserva el valor anterior y lo reintenta en la siguiente petición', async () => {
            let reloj = 0;
            const cache = crearCacheTemporal<number>(1000, () => reloj, 15_000);
            await cache.obtener('mapa', () => Promise.resolve(1));

            reloj = 2000;
            const fallido = diferida<number>();
            await expect(cache.obtener('mapa', () => fallido.promesa)).resolves.toBe(1);
            fallido.rechazar(new Error('base caída'));
            await expect(fallido.promesa).rejects.toThrow('base caída');
            await Promise.resolve();

            const reintento = vi.fn(() => Promise.resolve(4));
            await expect(cache.obtener('mapa', reintento)).resolves.toBe(1);
            expect(reintento).toHaveBeenCalledOnce();
        });
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
