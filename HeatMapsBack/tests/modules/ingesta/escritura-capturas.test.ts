import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CAPACIDAD_FILAS,
    ESCRITURAS_SIMULTANEAS,
    ESPERA_MAXIMA_MS,
    ESPERA_REINTENTO_MS,
    EscrituraCapturasService,
    FILAS_POR_LOTE,
} from '../../../src/modules/ingesta/escritura-capturas.service';
import type { CapturaInsert } from '../../../src/persistencia/repositorios/captura.repository';
import { loggerFalso } from '../../helpers/dobles';

/** `n` filas numeradas a partir de `desde`, para seguir su orden. */
const filas = (n: number, desde = 0): CapturaInsert[] => Array.from({ length: n }, (_, i) => ({
    macHash: String(desde + i), idSensor: 'nodo-1', rssi: -60, distanciaEstimada: 2,
    canal: 6, tipoTrama: 'associated', esMacRandom: false, timestampCaptura: new Date(0),
}));

/** Promesa controlable desde fuera, para decidir cuándo termina una escritura. */
const diferida = () => {
    let resolver!: () => void;
    let rechazar!: (err: Error) => void;
    const promesa = new Promise<number>((ok, ko) => {
        resolver = () => ok(0);
        rechazar = ko;
    });
    return { promesa, resolver, rechazar };
};

let insertMany: ReturnType<typeof vi.fn>;
let pendientes: ReturnType<typeof diferida>[];
let logger: ReturnType<typeof loggerFalso>;
let servicio: EscrituraCapturasService;

/** Tamaño de cada lote enviado a la base, en orden. */
const lotes = () => insertMany.mock.calls.map((llamada) => (llamada[0] as CapturaInsert[]).length);

/** Escritura que no termina nunca: la base no responde. */
const nuncaTermina = () => new Promise<number>(() => {
    /* sin respuesta */
});

/** Deja correr las promesas ya resueltas. */
const vaciarMicrotareas = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
    vi.useFakeTimers();
    pendientes = [];
    insertMany = vi.fn(() => {
        const escritura = diferida();
        pendientes.push(escritura);
        return escritura.promesa;
    });
    logger = loggerFalso();
    servicio = new EscrituraCapturasService({ insertMany } as never, logger);
});

afterEach(() => vi.useRealTimers());

describe('EscrituraCapturasService', () => {
    it('encolar vuelve sin esperar a la base', () => {
        servicio.encolar(filas(10));
        expect(insertMany).not.toHaveBeenCalled();
        expect(servicio.filasPendientes).toBe(10);
        servicio.encolar([]);
        expect(servicio.filasPendientes).toBe(10);
    });

    it('un lote incompleto se escribe al cumplirse la espera máxima', () => {
        servicio.encolar(filas(300));
        servicio.encolar(filas(200, 300));
        vi.advanceTimersByTime(ESPERA_MAXIMA_MS - 1);
        expect(insertMany).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(lotes()).toEqual([500]);
        expect(servicio.filasPendientes).toBe(0);
    });

    it('junta lecturas en lotes llenos y mantiene varias escrituras a la vez, en orden', async () => {
        servicio.encolar(filas(FILAS_POR_LOTE * 3 + 10));
        expect(lotes()).toEqual(Array(ESCRITURAS_SIMULTANEAS).fill(FILAS_POR_LOTE));
        expect((insertMany.mock.calls[1][0] as CapturaInsert[])[0].macHash).toBe(String(FILAS_POR_LOTE));

        pendientes[0].resolver();
        await vaciarMicrotareas();
        expect(lotes()).toEqual([...Array(ESCRITURAS_SIMULTANEAS).fill(FILAS_POR_LOTE), FILAS_POR_LOTE]);

        pendientes[1].resolver();
        await vaciarMicrotareas();
        vi.advanceTimersByTime(ESPERA_MAXIMA_MS);
        expect(lotes().at(-1)).toBe(10);
    });

    it('si la escritura falla, devuelve el lote al principio y reintenta tras una pausa', async () => {
        servicio.encolar(filas(100));
        vi.advanceTimersByTime(ESPERA_MAXIMA_MS);
        servicio.encolar(filas(50, 100));
        pendientes[0].rechazar(new Error('base caída'));
        await vaciarMicrotareas();

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('100 capturas'), expect.any(Error));
        expect(servicio.filasPendientes).toBe(150);
        servicio.encolar(filas(1, 150));
        vi.advanceTimersByTime(ESPERA_REINTENTO_MS - 1);
        expect(insertMany).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(1);
        const reintento = insertMany.mock.calls[1][0] as CapturaInsert[];
        expect(reintento.map((fila) => fila.macHash)).toEqual(filas(151).map((fila) => fila.macHash));
    });

    it('con el búfer lleno descarta las filas más antiguas y avisa una vez por minuto', () => {
        insertMany.mockImplementation(nuncaTermina);
        servicio.encolar(filas(CAPACIDAD_FILAS + FILAS_POR_LOTE * ESCRITURAS_SIMULTANEAS));
        expect(servicio.filasPendientes).toBe(CAPACIDAD_FILAS);
        expect(logger.warn).not.toHaveBeenCalled();

        servicio.encolar(filas(5, 1_000_000));
        servicio.encolar(filas(5, 2_000_000));
        expect(servicio.filasPendientes).toBe(CAPACIDAD_FILAS);
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('5 capturas descartadas'));
    });

    it('al terminar escribe lo pendiente aunque el lote no esté lleno', async () => {
        insertMany.mockImplementation(() => Promise.resolve(0));
        servicio.encolar(filas(FILAS_POR_LOTE * 2 + 7));
        const fin = servicio.terminar();
        await vi.advanceTimersByTimeAsync(300);
        await fin;
        expect(lotes()).toEqual([FILAS_POR_LOTE, FILAS_POR_LOTE, 7]);
        expect(servicio.filasPendientes).toBe(0);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('al terminar sin base avisa de lo que se pierde', async () => {
        insertMany.mockImplementation(nuncaTermina);
        servicio.encolar(filas(FILAS_POR_LOTE * 3));
        const fin = servicio.terminar(1_000);
        await vi.advanceTimersByTimeAsync(1_100);
        await fin;
        expect(logger.warn).toHaveBeenCalledWith(`${FILAS_POR_LOTE} capturas sin escribir al cerrar`);
    });
});
