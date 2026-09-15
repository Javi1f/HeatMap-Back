import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Base de datos simulada: el driver se sustituye y cada prueba define qué responde. */
const { bd } = vi.hoisted(() => ({
    bd: {
        responder: (_sql: string): unknown => [[]],
        flujo: (_sql: string): Record<string, unknown>[] => [],
        consultas: [] as string[],
        conexiones: [] as Record<string, unknown>[],
    },
}));

vi.mock('mysql2/promise', async (original) => {
    const real = (await original()) as { default: Record<string, unknown> };
    const createConnection = vi.fn((opciones: unknown) => {
        const conexion = {
            opciones,
            query: vi.fn((sql: string) => {
                bd.consultas.push(sql);
                return Promise.resolve(bd.responder(sql));
            }),
            changeUser: vi.fn(),
            end: vi.fn(),
            connection: {
                query: (sql: string) => ({
                    async *stream() {
                        yield* bd.flujo(sql);
                    },
                }),
            },
        };
        bd.conexiones.push(conexion);
        return Promise.resolve(conexion);
    });
    return { default: { ...real.default, createConnection } };
});

import { container } from 'tsyringe';
import { EnvService } from '../../src/common/env/env.service';
import { DatabaseConfig } from '../../src/config/database.config';
import { SensingConfig } from '../../src/config/sensing.config';
import { InfraestructuraRepository } from '../../src/modules/sensor/repositories/infraestructura.repository';
import { CapturaRepository } from '../../src/modules/sensor/repositories/captura.repository';
import { MacAnonymizerService } from '../../src/modules/sensor/services/mac-anonymizer.service';
import * as excluir from '../../src/scripts/excluir-dispositivo';
import * as medirScript from '../../src/scripts/medir-dispositivo';
import { opcionesConexion, principal as respaldar } from '../../src/scripts/respaldo-bd';
import { principal as restaurar } from '../../src/scripts/restaurar-bd';

/* MAC sintética. */
const MAC = '02:00:5e:10:00:01';

let salida: string[];
let argvOriginal: string[];

/** Simula los argumentos con los que se lanzó el script. */
const conArgumentos = (...argumentos: string[]) => { process.argv = ['node', 'script', ...argumentos]; };

beforeEach(() => {
    salida = [];
    argvOriginal = process.argv;
    vi.spyOn(process.stdout, 'write').mockImplementation((texto) => { salida.push(String(texto)); return true; });
    bd.consultas = [];
    bd.conexiones = [];
    process.exitCode = undefined;
});

afterEach(() => {
    process.argv = argvOriginal;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
    container.clearInstances();
});

/** Registra una conexión a base de datos falsa. */
const registrarBase = () => {
    const db = { initialize: vi.fn(), dataSource: { destroy: vi.fn() } };
    container.registerInstance(DatabaseConfig, db as never);
    return db;
};

describe('dispositivo:excluir', () => {
    it('reconoce MAC en cualquier formato', () => {
        expect(excluir.esMac('02005E100001')).toBe(true);
        expect(excluir.esMac(MAC)).toBe(true);
        expect(excluir.esMac('02:00:5e')).toBe(false);
    });

    it.each([[[]], [['no-mac']], [[MAC, '--otra']]])('muestra el uso con argumentos %j', async (argumentos) => {
        conArgumentos(...argumentos);
        await excluir.principal();
        expect(salida.join('')).toContain('Uso: npm run dispositivo:excluir');
        expect(process.exitCode).toBe(1);
    });

    it('excluye guardando sólo el hash y cierra la base', async () => {
        const db = registrarBase();
        const repo = { registrar: vi.fn(), eliminar: vi.fn() };
        container.registerInstance(InfraestructuraRepository, repo as never);
        conArgumentos(MAC);

        await excluir.principal();

        const hash = container.resolve(MacAnonymizerService).hash(MAC);
        expect(repo.registrar).toHaveBeenCalledWith([{ macHash: hash, motivo: 'manual' }], expect.any(Date));
        expect(JSON.stringify(repo.registrar.mock.calls)).not.toContain('02:00');
        expect(db.dataSource.destroy).toHaveBeenCalledOnce();
        expect(salida.join('')).toContain('Dispositivo excluido');
    });

    it.each([[true, 'Exclusión eliminada'], [false, 'no estaba excluido']])('--quitar cuando existía=%s', async (habia, mensaje) => {
        registrarBase();
        container.registerInstance(InfraestructuraRepository, { eliminar: vi.fn(() => Promise.resolve(habia)) } as never);
        conArgumentos(MAC, '--quitar');
        await excluir.principal();
        expect(salida.join('')).toContain(mensaje);
    });

    it('cierra la base aunque falle la operación', async () => {
        const db = registrarBase();
        container.registerInstance(InfraestructuraRepository, { registrar: vi.fn(() => Promise.reject(new Error('bd'))) } as never);
        conArgumentos(MAC);
        await expect(excluir.principal()).rejects.toThrow('bd');
        expect(db.dataSource.destroy).toHaveBeenCalledOnce();
    });
});

describe('dispositivo:medir', () => {
    /** Hash de la MAC sintética, con la clave del entorno de pruebas. */
    const hash = () => container.resolve(MacAnonymizerService).hash(MAC);
    /** Señal media de un dispositivo en un nodo de la zona `z`. */
    const senal = (macHash: string, idSensor: string, rssi: number) => ({ idZona: 'z', macHash, idSensor, rssi, esMacRandom: false });

    /** Registra capturas, infraestructura y configuración falsas para una medición. */
    const preparar = (senales: (h: string) => unknown[], excluidos: string[] = []) => {
        container.registerInstance(CapturaRepository, { senalesPorNodo: vi.fn(() => Promise.resolve(senales(hash()))) } as never);
        container.registerInstance(InfraestructuraRepository, { vigentes: vi.fn(() => Promise.resolve(new Set(excluidos))) } as never);
        container.registerInstance(SensingConfig, { infraestructuraVigenciaHoras: 24, presenciaRssiMinimoDbm: -75, macHashKey: Buffer.alloc(32, 0xaa) } as never);
    };

    it('explica cada veredicto', () => {
        expect(medirScript.veredicto(true, false, [], -75)).toBe('PRESENTE');
        expect(medirScript.veredicto(false, true, [], -75)).toBe('EXCLUIDO como infraestructura');
        expect(medirScript.veredicto(false, false, ['n3'], -75)).toBe('FUERA: no lo oye n3');
        expect(medirScript.veredicto(false, false, [], -75)).toBe('FUERA: el nodo más débil no llega a -75 dBm');
    });

    it('avisa si ningún nodo lo ha oído', async () => {
        preparar(() => [senal('otro', 'n1', -50)]);
        await medirScript.medir(hash());
        expect(salida.join('')).toContain('ningún nodo lo ha oído en los últimos 30 s');
    });

    it('muestra la señal por nodo y si cuenta como presente', async () => {
        preparar((huella) => [senal(huella, 'n1', -60.4), senal(huella, 'n2', -70), senal('otro', 'n3', -50)]);
        await medirScript.medir(hash());
        const linea = salida.join('');
        expect(linea).toContain('n1  -60');
        expect(linea).toContain('n3   —');
        expect(linea).toContain('más débil -70 dBm | FUERA: no lo oye n3');
    });

    it('reconoce un dispositivo presente', async () => {
        preparar((huella) => [senal(huella, 'n1', -60), senal(huella, 'n2', -65)]);
        await medirScript.medir(hash());
        expect(salida.join('')).toContain('| PRESENTE');
    });

    it('rechaza una MAC inválida', async () => {
        conArgumentos('xx');
        await medirScript.principal();
        expect(salida.join('')).toContain('Uso: npm run dispositivo:medir');
        expect(process.exitCode).toBe(1);
    });

    it('mide en bucle hasta Ctrl+C y cierra la base', async () => {
        vi.useFakeTimers();
        const db = registrarBase();
        preparar(() => []);
        /** Manejador de Ctrl+C que registra el script; se captura al espiar `process.once`. */
        let parar = (): void => {
            /* se sustituye por el manejador real */
        };
        vi.spyOn(process, 'once').mockImplementation(((evento: string, fn: () => void) => { if (evento === 'SIGINT') parar = fn; return process; }) as never);
        conArgumentos(MAC);

        const ejecucion = medirScript.principal();
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5_000);
        parar();
        await vi.advanceTimersByTimeAsync(5_000);
        await ejecucion;

        expect(salida.filter((linea) => linea.includes('ningún nodo')).length).toBe(2);
        expect(db.dataSource.destroy).toHaveBeenCalledOnce();
    });
});

describe('bd:respaldo y bd:restaurar', () => {
    let carpeta: string;
    beforeEach(() => { carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'respaldo-')); });
    afterEach(() => fs.rmSync(carpeta, { recursive: true, force: true }));

    /** `EnvService` que devuelve los valores indicados y el resto del entorno de pruebas. */
    const envCon = (valores: Record<string, unknown>) => {
        const real = container.resolve(EnvService);
        return { get: (clave: string) => (clave in valores ? valores[clave] : real.get(clave as never)) } as unknown as EnvService;
    };

    it('las opciones de conexión cifran siempre y verifican con CA', () => {
        expect(opcionesConexion(envCon({ DB_SSL_CA: undefined }))).toMatchObject({ host: 'localhost', port: 3306, user: 'test', ssl: { rejectUnauthorized: false }, dateStrings: true });
        expect(opcionesConexion(envCon({ DB_SSL_CA: Buffer.from('CA').toString('base64') })).ssl).toEqual({ ca: 'CA', rejectUnauthorized: true });
    });

    /** Base con tres tablas: una pequeña, una de 501 filas y una que se excluye. */
    const baseSimulada = () => {
        const capturas = Array.from({ length: 501 }, (_, i) => ({ id: i + 1, nota: i === 0 ? "l'ínea\nnueva" : null }));
        bd.responder = (sql) => {
            if (sql.startsWith('SHOW FULL TABLES')) return [[{ Tables_in_test: 'zona' }, { Tables_in_test: 'captura' }, { Tables_in_test: 'sesion' }]];
            if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': `CREATE TABLE ${sql.split(' ').pop()} (\n  id int\n)` }]];
            if (sql.startsWith('SHOW COLUMNS FROM `zona`')) return [[{ Field: 'id' }, { Field: 'nombre' }]];
            if (sql.startsWith('SHOW COLUMNS')) return [[{ Field: 'id' }, { Field: 'nota' }]];
            return [[]];
        };
        bd.flujo = (sql) => (sql.includes('`zona`') ? [{ id: 1, nombre: 'Plazoleta' }] : capturas);
    };

    it('vuelca estructura y datos por lotes, con manifiesto y tablas excluidas', async () => {
        baseSimulada();
        conArgumentos('--excluir', 'sesion');

        await respaldar(carpeta);

        const [archivo] = fs.readdirSync(carpeta);
        expect(archivo).toMatch(/^respaldo-test-.*\.sql\.gz$/);
        const lineas = zlib.gunzipSync(fs.readFileSync(path.join(carpeta, archivo))).toString('utf8').trim().split('\n');
        expect(lineas[1]).toBe('SET NAMES utf8mb4;');
        expect(lineas).toContain('CREATE TABLE IF NOT EXISTS `zona` ( id int );');
        expect(lineas).toContain('-- filas zona 1');
        expect(lineas).toContain('-- filas captura 501');
        expect(lineas.filter((linea) => linea.startsWith('INSERT INTO `captura`'))).toHaveLength(2);
        expect(lineas.join('\n')).not.toContain('`sesion`');
        expect(salida.join('')).toContain('sesion: excluida');
        expect(bd.conexiones[0].end).toHaveBeenCalledOnce();
    });

    it('restaura en otra base y verifica el número de filas', async () => {
        baseSimulada();
        conArgumentos();
        await respaldar(carpeta);
        const archivo = path.join(carpeta, fs.readdirSync(carpeta)[0]);

        bd.consultas = [];
        bd.responder = (sql) => (sql.startsWith('SELECT COUNT') ? [[{ total: sql.includes('`zona`') ? 1 : 501 }]] : [[]]);
        conArgumentos(archivo, '--base', 'prueba_restauracion');
        salida = [];

        await restaurar();

        const conexion = bd.conexiones[bd.conexiones.length - 1];
        expect(bd.consultas[0]).toContain('CREATE DATABASE IF NOT EXISTS `prueba_restauracion`');
        expect(conexion.changeUser).toHaveBeenCalledWith({ database: 'prueba_restauracion' });
        expect(bd.consultas.some((sentencia) => sentencia.startsWith('INSERT INTO `captura`'))).toBe(true);
        expect(bd.consultas.some((sentencia) => sentencia.startsWith('--'))).toBe(false);
        expect(salida.join('')).toContain('3 de 3 tablas restauradas');
        expect(process.exitCode).toBeUndefined();
    });

    it('marca fallo si una tabla no cuadra', async () => {
        baseSimulada();
        conArgumentos();
        await respaldar(carpeta);
        const archivo = path.join(carpeta, fs.readdirSync(carpeta)[0]);
        bd.responder = (sql) => (sql.startsWith('SELECT COUNT') ? [[{ total: 0 }]] : [[]]);
        conArgumentos(archivo, '--base', 'otra');

        await restaurar();

        expect(salida.join('')).toContain('FALLA zona: 0 de 1 filas');
        expect(process.exitCode).toBe(1);
    });

    it.each([[[]], [['--base', 'x']], [['archivo.sql.gz']]])('restaurar exige archivo y base (%j)', async (argumentos) => {
        conArgumentos(...argumentos);
        await restaurar();
        expect(salida.join('')).toContain('Uso: npm run bd:restaurar');
        expect(process.exitCode).toBe(1);
    });

    it('se niega a restaurar sobre la base de la aplicación sin --sobrescribir', async () => {
        conArgumentos('a.sql.gz', '--base', 'test');
        await restaurar();
        expect(salida.join('')).toContain('es la de la aplicación');
        expect(bd.conexiones).toHaveLength(0);
    });
});
