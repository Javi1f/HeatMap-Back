/**
 * Genera una copia de seguridad completa de la base de datos: estructura y
 * datos de todas las tablas, en un archivo SQL comprimido.
 *
 * No necesita `mysqldump`: lee con el mismo driver que la aplicación y por
 * flujo, de modo que tablas grandes no se cargan en memoria.
 *
 * Uso:
 *   `npm run bd:respaldo`
 *   `npm run bd:respaldo -- --excluir captura`   (sin las tablas indicadas, separadas por comas)
 *
 * Deja el archivo en `respaldos/`, que no se sube al repositorio.
 */
import '../loadEnv';
import 'reflect-metadata';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { once } from 'events';
import mysql from 'mysql2/promise';
import { EnvService } from '../common/env/env.service';
import { container } from 'tsyringe';
import {
    FILAS_POR_INSERT,
    crearTablaEnUnaLinea,
    identificador,
    lineaManifiesto,
    sentenciaInsert,
} from './respaldo-sql';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Opciones de conexión a partir de la configuración de la aplicación. */
export const opcionesConexion = (env: EnvService): mysql.ConnectionOptions => {
    const ca = env.get('DB_SSL_CA');
    return {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USERNAME'),
        password: env.get('DB_PASSWORD'),
        ssl: ca ? { ca: Buffer.from(ca, 'base64').toString('utf8'), rejectUnauthorized: true } : { rejectUnauthorized: false },
        charset: 'utf8mb4',
        dateStrings: true,
        supportBigNumbers: true,
        bigNumberStrings: true,
        jsonStrings: true,
    };
};

/** Escapa un valor para SQL con el driver de MySQL. */
const escapar = (valor: unknown): string => mysql.escape(valor as Parameters<typeof mysql.escape>[0]);

/**
 * Consulta en modo flujo.
 *
 * La API de promesas de `mysql2` no expone el flujo de filas en sus tipos,
 * aunque la conexión subyacente sí lo ofrece.
 */
const consultarEnFlujo = (conexion: mysql.Connection, sql: string): AsyncIterable<Record<string, unknown>> =>
    (conexion as unknown as { connection: { query: (sql: string) => { stream: () => AsyncIterable<Record<string, unknown>> } } })
        .connection.query(sql).stream();

/** Escribe en el flujo respetando la contrapresión. */
const volcar = async (salida: NodeJS.WritableStream, texto: string): Promise<void> => {
    if (!salida.write(`${texto}\n`)) await once(salida, 'drain');
};

/** Vuelca los datos de una tabla y devuelve cuántas filas escribió. */
const volcarTabla = async (conexion: mysql.Connection, tabla: string, salida: NodeJS.WritableStream): Promise<number> => {
    const [columnas] = await conexion.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${identificador(tabla)}`);
    const nombres = columnas.map((columna) => String(columna.Field));
    const flujo = consultarEnFlujo(conexion, `SELECT * FROM ${identificador(tabla)}`);

    let lote: Record<string, unknown>[] = [];
    let total = 0;
    for await (const fila of flujo) {
        lote.push(fila);
        if (lote.length === FILAS_POR_INSERT) {
            await volcar(salida, sentenciaInsert(tabla, nombres, lote, escapar));
            total += lote.length;
            lote = [];
        }
    }
    if (lote.length > 0) {
        await volcar(salida, sentenciaInsert(tabla, nombres, lote, escapar));
        total += lote.length;
    }
    return total;
};

/**
 * Punto de entrada.
 *
 * @param carpeta - Dónde dejar el archivo; por defecto `respaldos/` en la raíz del proyecto.
 */
export const principal = async (carpeta = path.resolve(__dirname, '..', '..', 'respaldos')): Promise<void> => {
    const indice = process.argv.indexOf('--excluir');
    const excluidas = new Set(indice > -1 ? (process.argv[indice + 1] ?? '').split(',').filter(Boolean) : []);

    const env = container.resolve(EnvService);
    const base = env.get('DB_DATABASE');
    const conexion = await mysql.createConnection({ ...opcionesConexion(env), database: base });

    fs.mkdirSync(carpeta, { recursive: true });
    const archivo = path.join(carpeta, `respaldo-${base}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`);
    const gzip = zlib.createGzip();
    const destino = fs.createWriteStream(archivo);
    gzip.pipe(destino);

    try {
        await volcar(gzip, `-- Respaldo de ${base} generado el ${new Date().toISOString()}`);
        await volcar(gzip, 'SET NAMES utf8mb4;');
        await volcar(gzip, 'SET FOREIGN_KEY_CHECKS = 0;');

        const [tablas] = await conexion.query<mysql.RowDataPacket[]>("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        // Tabla a tabla y en orden: todas escriben en el mismo flujo comprimido y
        // la restauración necesita cada CREATE TABLE antes de sus INSERT.
        for (const fila of tablas) {
            const tabla = String(Object.values(fila)[0]);
            if (excluidas.has(tabla)) {
                escribir(`  ${tabla}: excluida`);
                continue;
            }
            const [[creacion]] = await conexion.query<mysql.RowDataPacket[]>(`SHOW CREATE TABLE ${identificador(tabla)}`); // skipcq: JS-0032
            await volcar(gzip, crearTablaEnUnaLinea(String(creacion['Create Table']))); // skipcq: JS-0032
            const filas = await volcarTabla(conexion, tabla, gzip); // skipcq: JS-0032
            await volcar(gzip, lineaManifiesto(tabla, filas)); // skipcq: JS-0032
            escribir(`  ${tabla}: ${filas} filas`);
        }

        await volcar(gzip, 'SET FOREIGN_KEY_CHECKS = 1;');
        gzip.end();
        await once(destino, 'finish');
        escribir(`\nRespaldo completo: ${archivo} (${(fs.statSync(archivo).size / 1024).toFixed(0)} KB)`);
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
