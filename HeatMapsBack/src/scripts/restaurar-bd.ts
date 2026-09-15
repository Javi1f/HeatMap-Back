/**
 * Restaura un respaldo generado con `npm run bd:respaldo` y verifica que cada
 * tabla quede con el mismo número de filas que declara el archivo.
 *
 * Por seguridad exige indicar la base de destino y se niega a restaurar sobre
 * la base configurada en la aplicación salvo que se pida explícitamente: una
 * restauración sobre producción mezclaría los datos restaurados con los vivos.
 *
 * Uso:
 *   `npm run bd:restaurar -- respaldos/archivo.sql.gz --base nombre_de_prueba`
 *   `npm run bd:restaurar -- respaldos/archivo.sql.gz --base <base de la app> --sobrescribir`
 */
import '../loadEnv';
import 'reflect-metadata';
import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import mysql from 'mysql2/promise';
import { container } from 'tsyringe';
import { EnvService } from '../common/env/env.service';
import { opcionesConexion } from './respaldo-bd';
import { esSentencia, identificador, leerManifiesto } from './respaldo-sql';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Valor de una opción de línea de comandos. */
const opcion = (nombre: string): string | undefined => {
    const indice = process.argv.indexOf(nombre);
    return indice > -1 ? process.argv[indice + 1] : undefined;
};

/** Ejecuta el archivo y devuelve el manifiesto de filas esperadas por tabla. */
const ejecutarArchivo = async (conexion: mysql.Connection, archivo: string): Promise<Map<string, number>> => {
    const esperadas = new Map<string, number>();
    const lineas = readline.createInterface({ input: fs.createReadStream(archivo).pipe(zlib.createGunzip()), crlfDelay: Infinity });

    for await (const linea of lineas) {
        const manifiesto = leerManifiesto(linea);
        if (manifiesto) esperadas.set(manifiesto.tabla, manifiesto.filas);
        else if (esSentencia(linea)) await conexion.query(linea);
    }
    return esperadas;
};

/** Archivo y base indicados en la línea de comandos, o `null` si faltan. */
const argumentos = (): { archivo: string; base: string } | null => {
    const archivo = process.argv[2];
    const base = opcion('--base');
    if (!archivo || archivo.startsWith('--') || !base) return null;
    return { archivo, base };
};

/**
 * Compara las filas de cada tabla con las que declara el manifiesto.
 *
 * @returns Cuántas tablas coinciden.
 */
const verificarConteos = async (conexion: mysql.Connection, esperadas: Map<string, number>): Promise<number> => {
    // Los conteos son independientes entre sí: se piden todos a la vez.
    const conteos = await Promise.all(
        [...esperadas].map(async ([tabla, filas]) => {
            const [[{ total }]] = await conexion.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${identificador(tabla)}`);
            return { tabla, filas, total: Number(total) };
        }),
    );

    let correctas = 0;
    for (const { tabla, filas, total } of conteos) {
        const coincide = total === filas;
        if (coincide) correctas++;
        escribir(`  ${coincide ? 'OK   ' : 'FALLA'} ${tabla}: ${total} de ${filas} filas`);
    }
    return correctas;
};

/** Punto de entrada. */
export const principal = async (): Promise<void> => {
    const indicados = argumentos();
    if (!indicados) {
        escribir('Uso: npm run bd:restaurar -- <archivo.sql.gz> --base <nombre> [--sobrescribir]');
        process.exitCode = 1;
        return;
    }
    const { archivo, base } = indicados;

    const env = container.resolve(EnvService);
    if (base === env.get('DB_DATABASE') && !process.argv.includes('--sobrescribir')) {
        escribir(`La base «${base}» es la de la aplicación. Restaura en otra base o añade --sobrescribir.`);
        process.exitCode = 1;
        return;
    }

    const conexion = await mysql.createConnection(opcionesConexion(env));
    try {
        await conexion.query(`CREATE DATABASE IF NOT EXISTS ${identificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await conexion.changeUser({ database: base });

        const esperadas = await ejecutarArchivo(conexion, archivo);
        const correctas = await verificarConteos(conexion, esperadas);
        escribir(`\n${correctas} de ${esperadas.size} tablas restauradas con el número de filas esperado en «${base}».`);
        if (correctas !== esperadas.size) process.exitCode = 1;
    } finally {
        await conexion.end();
    }
};

if (require.main === module) {
    principal().catch((err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
