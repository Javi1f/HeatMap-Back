/**
 * Comprueba que la base de datos y las entidades describen el mismo esquema.
 *
 * El esquema lo manda `bd/database.sql`; las entidades TypeORM tienen que
 * reflejarlo columna a columna, índice a índice. Si difieren, la sincronización
 * automática (`DB_SYNCHRONIZE`) intentaría «corregir» la base borrando y
 * recreando columnas, que es como se pierden datos. Este comando pregunta a
 * TypeORM qué sentencias ejecutaría para igualarlas y **no ejecuta ninguna**.
 *
 * Sin diferencias termina con código 0; con alguna, las lista y termina con 1,
 * de modo que puede usarse como comprobación antes de desplegar.
 *
 * Uso: `npm run bd:deriva`
 */
import '../loadEnv';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { DatabaseConfig } from '../config/database.config';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/**
 * Sentencias que igualarían la base con las entidades.
 *
 * @param db - Configuración de la base, ya inicializada.
 */
export const sentenciasDeDeriva = async (db: DatabaseConfig): Promise<string[]> => {
    const plan = await db.dataSource.driver.createSchemaBuilder().log();
    return plan.upQueries.map((consulta) => consulta.query);
};

/** Punto de entrada: informa de la deriva y fija el código de salida. */
export const principal = async (): Promise<void> => {
    const db = container.resolve(DatabaseConfig);
    await db.initialize();
    try {
        const sentencias = await sentenciasDeDeriva(db);
        if (sentencias.length === 0) {
            escribir('Sin deriva: la base y las entidades describen el mismo esquema.');
            return;
        }
        escribir(`${sentencias.length} diferencias entre la base y las entidades:`);
        sentencias.forEach((sentencia) => escribir(`  ${sentencia}`));
        process.exitCode = 1;
    } finally {
        await db.destroy();
    }
};

if (require.main === module) {
    principal().catch((err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
