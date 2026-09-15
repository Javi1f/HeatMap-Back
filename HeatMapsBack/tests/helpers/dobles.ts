import { vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { LoggerService } from '../../src/common/logger/logger.service';

/**
 * Dobles de prueba compartidos.
 *
 * Los servicios reciben sus dependencias por constructor, así que las pruebas
 * los instancian directamente con estos dobles en lugar de pasar por el
 * contenedor: cada prueba controla exactamente con qué colabora.
 */

/** Implementación para espías de consola: descarta la salida. */
export const silenciar = (): void => {
    /* sin salida durante las pruebas */
};

/**
 * Devuelve el valor comprobando antes que existe.
 *
 * Sustituye a la aserción `!`: si falta, la prueba falla aquí con un mensaje
 * claro en lugar de un `TypeError` más adelante.
 */
export const definido = <T>(valor: T | null | undefined, que = 'valor'): T => {
    if (valor === null || valor === undefined) throw new Error(`Se esperaba ${que}`);
    return valor;
};

/** Logger que no escribe y registra sus llamadas. */
export const loggerFalso = () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
}) as unknown as LoggerService & Record<'error' | 'warn' | 'info' | 'debug', ReturnType<typeof vi.fn>>;

/** Respuesta de Express que registra el código de estado y el cuerpo enviado. */
export const resFalsa = () => {
    const res = {
        statusCode: 200,
        cuerpo: undefined as unknown,
        status: vi.fn(),
        json: vi.fn(),
        send: vi.fn(),
        setHeader: vi.fn(),
        end: vi.fn(),
        headersSent: false,
    };
    res.status.mockImplementation((codigo: number) => {
        res.statusCode = codigo;
        return res;
    });
    res.json.mockImplementation((cuerpo: unknown) => {
        res.cuerpo = cuerpo;
        return res;
    });
    res.send.mockImplementation((cuerpo: unknown) => {
        res.cuerpo = cuerpo;
        return res;
    });
    return res as typeof res & Response;
};

/** Petición de Express con los campos indicados. */
export const reqFalsa = (campos: Record<string, unknown> = {}): Request =>
    ({ body: {}, params: {}, query: {}, headers: {}, ip: '127.0.0.1', ...campos }) as unknown as Request;

/** Función `next` de Express espiable. */
export const nextFalso = () => vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;

/**
 * Configuración de base de datos falsa cuyo `getRepository` devuelve el
 * repositorio de TypeORM simulado que se le pase.
 */
export const dbFalsa = (repo: unknown, extra: Record<string, unknown> = {}) =>
    ({ dataSource: { getRepository: vi.fn(() => repo), ...extra } }) as never;

/**
 * Cifrador de campos transparente: deja ver en las aserciones qué se cifró y
 * qué se hasheó sin depender de claves ni de IV aleatorios.
 */
export const cifradorFalso = () => ({
    encrypt: vi.fn((valor: string) => `enc(${valor})`),
    decrypt: vi.fn((valor: string) => valor.replace(/^enc\((.*)\)$/s, '$1')),
    hash: vi.fn((valor: string) => `h(${valor.toLowerCase().trim()})`),
});

/** Repositorio de TypeORM simulado con los métodos que usa la aplicación. */
export const repoTypeorm = () => {
    const repo = {
        find: vi.fn(() => Promise.resolve([] as unknown[])),
        findOne: vi.fn(() => Promise.resolve(null as unknown)),
        findOneBy: vi.fn(() => Promise.resolve(null as unknown)),
        count: vi.fn(() => Promise.resolve(0)),
        create: vi.fn((datos: unknown) => datos),
        save: vi.fn((datos: unknown) => Promise.resolve({ id: 1, ...(datos as object) })),
        insert: vi.fn(() => Promise.resolve({})),
        update: vi.fn(() => Promise.resolve({ affected: 1 })),
        upsert: vi.fn(() => Promise.resolve({})),
        delete: vi.fn(() => Promise.resolve({ affected: 1 })),
        increment: vi.fn(() => Promise.resolve({})),
        query: vi.fn(() => Promise.resolve([] as unknown[])),
        createQueryBuilder: vi.fn(),
    };
    return repo;
};

/**
 * Constructor de consultas de TypeORM encadenable: cada método devuelve el
 * mismo objeto y los métodos terminales resuelven con los valores indicados.
 */
export const consultaFalsa = (resultados: Partial<Record<'getMany' | 'getRawMany' | 'getRawOne' | 'getCount' | 'getOne', unknown>> = {}) => {
    const consulta: Record<string, ReturnType<typeof vi.fn>> = {};
    const encadenables = [
        'select', 'addSelect', 'from', 'leftJoin', 'leftJoinAndSelect', 'where', 'andWhere', 'orWhere',
        'groupBy', 'addGroupBy', 'orderBy', 'addOrderBy', 'limit', 'take', 'skip', 'setParameters',
    ];
    for (const metodo of encadenables) consulta[metodo] = vi.fn(() => consulta);
    // Un join contra una subconsulta recibe una función que la construye: se
    // ejecuta con otro constructor falso para que también quede cubierta.
    consulta.innerJoin = vi.fn((destino: unknown) => {
        // Las entidades también son funciones, pero sólo las flechas carecen de `prototype`.
        if (typeof destino === 'function' && !('prototype' in destino)) destino(consultaFalsa());
        return consulta;
    });
    consulta.getMany = vi.fn(() => Promise.resolve(resultados.getMany ?? []));
    consulta.getRawMany = vi.fn(() => Promise.resolve(resultados.getRawMany ?? []));
    consulta.getRawOne = vi.fn(() => Promise.resolve(resultados.getRawOne));
    consulta.getCount = vi.fn(() => Promise.resolve(resultados.getCount ?? 0));
    consulta.getOne = vi.fn(() => Promise.resolve(resultados.getOne ?? null));
    return consulta;
};
