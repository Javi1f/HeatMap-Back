/**
 * Lleva una base existente al esquema de `bd/database.sql`.
 *
 * Dos fases, en este orden:
 *
 * **A. Identificadores UUID** (solo si la base todavía usa enteros). El modelo
 * relacional (Anexo 13) identifica ADMIN y CORREO_PERMITIDO por UUID, y
 * `correo_permitido.anadido_por` y `alerta.resuelta_por` son claves foráneas a
 * ADMIN. Se asigna un UUID a cada fila y se reescriben con él todas las
 * referencias (sesiones, nodos, reportes, auditoría). Las dos columnas que
 * guardaban un nombre en texto se traducen a la cuenta que lo lleva; para eso
 * se descifran los nombres con la clave de la base, sin escribirlos en ningún
 * registro. Un nombre sin cuenta queda en `NULL`.
 *
 * **B. Índices y restricciones**. Se le pregunta a TypeORM qué sentencias
 * igualarían la base con las entidades y se ejecutan **solo** las que tocan
 * índices, claves únicas, claves foráneas y restricciones CHECK, más las
 * redefiniciones idénticas de columna (`CHANGE` con el mismo nombre, tipo y
 * nulabilidad que ya tiene), que TypeORM emite al retirar un índice único con
 * nombre autogenerado y no alteran ningún dato. Si el plan incluyera cualquier
 * otro cambio de columna —borrarla, crearla o cambiarle el tipo—, la fase se
 * detiene sin ejecutar nada: eso significaría que la base tiene una forma que
 * este script no conoce, y resolverlo a ciegas es como se pierden datos.
 *
 * Antes de pedirle el plan a TypeORM, los índices que ya tienen las columnas y
 * la unicidad correctas pero un nombre autogenerado (`IDX_…`, de cuando la base
 * se creó con la sincronización automática) se **renombran** al nombre del DDL.
 * Renombrar un índice solo cambia metadatos: es instantáneo aunque la tabla
 * tenga millones de filas, y evita que TypeORM lo borre y lo vuelva a crear.
 *
 * Sin `--aplicar` solo muestra el plan. Es idempotente: sobre una base ya
 * migrada no hace nada. Al terminar, `npm run bd:deriva` debe decir «Sin deriva».
 *
 * Uso:
 *   `npm run bd:migrar`             → muestra el plan
 *   `npm run bd:migrar -- --aplicar` → lo ejecuta
 */
import '../loadEnv';
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { container } from 'tsyringe';
import type { QueryRunner } from 'typeorm';
import { DatabaseConfig } from '../config/database.config';
import { DbFieldCipher } from '../crypto/db-field.crypto';
import { sentenciasDeDeriva } from './deriva-esquema';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Sentencia con sus parámetros. */
export interface Paso {
    sql: string;
    params?: unknown[];
}

/** Columna que referencia a `admin.id_admin`. */
interface Referencia {
    tabla: string;
    columna: string;
    nula: boolean;
}

/** Columnas que guardan el id de un administrador, además de la propia clave. */
export const REFERENCIAS_A_ADMIN: readonly Referencia[] = [
    { tabla: 'sesion_auth', columna: 'id_admin', nula: false },
    { tabla: 'sensor', columna: 'registrado_por', nula: true },
    { tabla: 'reporte', columna: 'id_admin', nula: false },
    { tabla: 'evento_auditoria', columna: 'id_admin', nula: true },
];

/** Lo que la fase A necesita saber de la base. */
export interface EstadoPrevio {
    /** Claves foráneas que apuntan a `admin`, por tabla. */
    clavesHaciaAdmin: readonly { tabla: string; nombre: string }[];
    /** Administradores: id entero y nombres ya descifrados. */
    admins: readonly { id: number; username: string; email: string }[];
    /** Correos permitidos: id entero y autor ya descifrado. */
    correos: readonly { id: number; autor: string | null }[];
    /** Valores distintos de `alerta.resuelta_por` (nombres en texto). */
    resolutores: readonly string[];
    /**
     * Colación de la tabla `admin`. Todas las columnas que guardan el id de un
     * administrador se crean con ella: la base mezcla colaciones entre tablas
     * (unas las creó la sincronización automática, otras el DDL), y una clave
     * foránea exige que las dos columnas compartan colación.
     */
    colacion: string;
}

/** Envuelve un identificador SQL entre acentos graves. */
const id = (nombre: string): string => `\`${nombre}\``;

/** Tipo de columna de un UUID con la colación dada. */
const uuidCon = (colacion: string): string => `CHAR(36) COLLATE ${colacion}`;

/** Reescribe una columna que referencia a un administrador con su UUID. */
const pasosDeReferencia = (ref: Referencia, uuidDe: ReadonlyMap<number, string>, colacion: string): Paso[] => {
    const nueva = `${ref.columna}_nueva`;
    return [
        { sql: `ALTER TABLE ${id(ref.tabla)} ADD COLUMN ${id(nueva)} ${uuidCon(colacion)} NULL AFTER ${id(ref.columna)}` },
        ...[...uuidDe].map(([entero, uuid]) => ({
            sql: `UPDATE ${id(ref.tabla)} SET ${id(nueva)} = ? WHERE ${id(ref.columna)} = ?`,
            params: [uuid, entero],
        })),
        {
            sql: `ALTER TABLE ${id(ref.tabla)} DROP COLUMN ${id(ref.columna)}, `
                + `CHANGE ${id(nueva)} ${id(ref.columna)} ${uuidCon(colacion)} ${ref.nula ? 'NULL' : 'NOT NULL'}`,
        },
    ];
};

/**
 * Plan de la fase A: pasar ADMIN y CORREO_PERMITIDO a UUID con todas sus
 * referencias. Es una función pura para poder probarla sin base de datos.
 *
 * @param estado - Situación de la base antes de migrar.
 * @param uuid   - Generador de identificadores (inyectable para las pruebas).
 */
export const planUuid = (estado: EstadoPrevio, uuid: () => string = randomUUID): Paso[] => {
    const uuidDe = new Map(estado.admins.map((admin) => [admin.id, uuid()]));
    const cuentaPorNombre = new Map<string, string>();
    for (const admin of estado.admins) {
        const nuevo = uuidDe.get(admin.id) as string;
        cuentaPorNombre.set(admin.username.trim().toLowerCase(), nuevo);
        cuentaPorNombre.set(admin.email.trim().toLowerCase(), nuevo);
    }
    /** UUID de la cuenta con ese nombre o correo, o `null` si no hay ninguna. */
    const cuentaDe = (nombre: string | null): string | null =>
        (nombre ? cuentaPorNombre.get(nombre.trim().toLowerCase()) : undefined) ?? null;
    const uuidCol = uuidCon(estado.colacion);

    return [
        { sql: 'SET FOREIGN_KEY_CHECKS = 0' },
        ...estado.clavesHaciaAdmin.map(({ tabla, nombre }) => ({
            sql: `ALTER TABLE ${id(tabla)} DROP FOREIGN KEY ${id(nombre)}`,
        })),

        // ADMIN
        { sql: `ALTER TABLE \`admin\` ADD COLUMN \`id_nuevo\` ${uuidCol} NULL FIRST` },
        ...[...uuidDe].map(([entero, nuevo]) => ({
            sql: 'UPDATE `admin` SET `id_nuevo` = ? WHERE `id_admin` = ?',
            params: [nuevo, entero],
        })),
        { sql: 'ALTER TABLE `admin` MODIFY `id_admin` INT UNSIGNED NOT NULL, DROP PRIMARY KEY' },
        {
            sql: 'ALTER TABLE `admin` DROP COLUMN `id_admin`, '
                + `CHANGE \`id_nuevo\` \`id_admin\` ${uuidCol} NOT NULL FIRST, ADD PRIMARY KEY (\`id_admin\`)`,
        },
        ...REFERENCIAS_A_ADMIN.flatMap((ref) => pasosDeReferencia(ref, uuidDe, estado.colacion)),

        // CORREO_PERMITIDO
        {
            sql: `ALTER TABLE \`correo_permitido\` ADD COLUMN \`id_nuevo\` ${uuidCol} NULL FIRST, `
                + `ADD COLUMN \`anadido_por_nuevo\` ${uuidCol} NULL AFTER \`anadido_por\``,
        },
        ...estado.correos.map((correo) => ({
            sql: 'UPDATE `correo_permitido` SET `id_nuevo` = ?, `anadido_por_nuevo` = ? WHERE `id_correo` = ?',
            params: [uuid(), cuentaDe(correo.autor), correo.id],
        })),
        { sql: 'ALTER TABLE `correo_permitido` MODIFY `id_correo` INT UNSIGNED NOT NULL, DROP PRIMARY KEY' },
        {
            sql: 'ALTER TABLE `correo_permitido` DROP COLUMN `id_correo`, DROP COLUMN `anadido_por`, '
                + `CHANGE \`id_nuevo\` \`id_correo\` ${uuidCol} NOT NULL FIRST, `
                + `CHANGE \`anadido_por_nuevo\` \`anadido_por\` ${uuidCol} NULL, ADD PRIMARY KEY (\`id_correo\`)`,
        },

        // ALERTA.resuelta_por: de nombre en texto a clave foránea
        { sql: `ALTER TABLE \`alerta\` ADD COLUMN \`resuelta_por_nueva\` ${uuidCol} NULL AFTER \`resuelta_por\`` },
        ...estado.resolutores.flatMap((nombre) => {
            const cuenta = cuentaDe(nombre);
            return cuenta
                ? [{ sql: 'UPDATE `alerta` SET `resuelta_por_nueva` = ? WHERE `resuelta_por` = ?', params: [cuenta, nombre] }]
                : [];
        }),
        { sql: `ALTER TABLE \`alerta\` DROP COLUMN \`resuelta_por\`, CHANGE \`resuelta_por_nueva\` \`resuelta_por\` ${uuidCol} NULL` },

        { sql: 'SET FOREIGN_KEY_CHECKS = 1' },
    ];
};

/** Tipo y nulabilidad actuales de una columna. */
export interface DefinicionColumna {
    tipo: string;
    nula: boolean;
}

/** Sentencias sobre índices y restricciones, que no tocan datos. */
const SOBRE_RESTRICCIONES =
    /^(DROP INDEX|CREATE (UNIQUE )?INDEX|ALTER TABLE `\w+` (DROP FOREIGN KEY|ADD CONSTRAINT|DROP CHECK|DROP INDEX|ADD UNIQUE INDEX))/;

/** `CHANGE` de una columna sobre sí misma, sin más cláusulas que el tipo y la nulabilidad. */
const REDEFINICION = /^ALTER TABLE `(\w+)` CHANGE `(\w+)` `(\w+)` (\S+) (NOT NULL|NULL)$/;

/**
 * `true` si la sentencia redefine una columna con exactamente el tipo y la
 * nulabilidad que ya tiene: no cambia ningún dato.
 */
const esRedefinicionIdentica = (
    sentencia: string,
    actual?: (tabla: string, columna: string) => DefinicionColumna | undefined,
): boolean => {
    const partes = REDEFINICION.exec(sentencia);
    if (!partes) return false;
    const [, tabla, antes, despues, tipo, nulabilidad] = partes;
    const definicion = actual?.(tabla, antes);
    return antes === despues
        && definicion !== undefined
        && definicion.tipo.toLowerCase() === tipo.toLowerCase()
        && definicion.nula === (nulabilidad === 'NULL');
};

/**
 * Separa el plan de TypeORM en lo que se puede aplicar sin tocar datos y lo
 * que no.
 *
 * @param sentencias - Plan de TypeORM.
 * @param actual     - Definición actual de una columna, según la base.
 */
export const clasificarPlan = (
    sentencias: readonly string[],
    actual?: (tabla: string, columna: string) => DefinicionColumna | undefined,
): { seguras: string[]; peligrosas: string[] } => {
    const seguras: string[] = [];
    const peligrosas: string[] = [];
    for (const sentencia of sentencias) {
        const segura = SOBRE_RESTRICCIONES.test(sentencia) || esRedefinicionIdentica(sentencia, actual);
        (segura ? seguras : peligrosas).push(sentencia);
    }
    return { seguras, peligrosas };
};

/** Índice deseado o existente: tabla, nombre, columnas en orden y unicidad. */
export interface IndiceDef {
    tabla: string;
    nombre: string;
    columnas: string;
    unico: boolean;
}

/**
 * Renombres que dejan cada índice existente con el nombre que declara el
 * esquema, cuando coinciden columnas y unicidad.
 *
 * @param deseados   - Índices y claves únicas de las entidades.
 * @param existentes - Índices de la base, sin la clave primaria.
 */
export const planRenombres = (deseados: readonly IndiceDef[], existentes: readonly IndiceDef[]): Paso[] => {
    /** Nombres de índice que ya existen en la tabla. */
    const nombresEn = (tabla: string): Set<string> =>
        new Set(existentes.filter((indice) => indice.tabla === tabla).map((indice) => indice.nombre));
    const pasos: Paso[] = [];
    const usados = new Set<string>();
    for (const deseado of deseados) {
        if (nombresEn(deseado.tabla).has(deseado.nombre)) continue;
        const candidato = existentes.find((indice) =>
            indice.tabla === deseado.tabla
            && indice.columnas === deseado.columnas
            && indice.unico === deseado.unico
            && !deseados.some((otro) => otro.tabla === indice.tabla && otro.nombre === indice.nombre)
            && !usados.has(`${indice.tabla}.${indice.nombre}`));
        if (!candidato) continue;
        usados.add(`${candidato.tabla}.${candidato.nombre}`);
        pasos.push({ sql: `ALTER TABLE ${id(deseado.tabla)} RENAME INDEX ${id(candidato.nombre)} TO ${id(deseado.nombre)}` });
    }
    return pasos;
};

/** Índices y claves únicas que declaran las entidades. */
const indicesDeseados = (db: DatabaseConfig): IndiceDef[] =>
    db.dataSource.entityMetadatas.flatMap((meta) => [
        ...meta.indices.map((indice) => ({
            tabla: meta.tableName,
            nombre: indice.name,
            columnas: indice.columns.map((columna) => columna.databaseName).join(','),
            unico: indice.isUnique,
        })),
        ...meta.uniques.map((unica) => ({
            tabla: meta.tableName,
            nombre: unica.name,
            columnas: unica.columns.map((columna) => columna.databaseName).join(','),
            unico: true,
        })),
    ]);

/** Índices de la base, sin la clave primaria. */
const indicesExistentes = async (qr: QueryRunner): Promise<IndiceDef[]> => {
    const filas: { tabla: string; nombre: string; columnas: string; unico: string | number }[] = await qr.query(
        'SELECT table_name AS tabla, index_name AS nombre, '
        + 'GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnas, MIN(non_unique) = 0 AS unico '
        + "FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name <> 'PRIMARY' "
        + 'GROUP BY table_name, index_name',
    );
    return filas.map((fila) => ({ tabla: fila.tabla, nombre: fila.nombre, columnas: fila.columnas, unico: Number(fila.unico) === 1 }));
};

/**
 * Orden de aplicación de las sentencias seguras.
 *
 * TypeORM borra los índices sobrantes antes de crear los nuevos, y eso falla
 * cuando el índice que sobra es el que sostiene una clave foránea hasta que
 * exista el que lo reemplaza (en `captura`, el índice suelto de `id_sensor`
 * frente al compuesto `id_sensor, timestamp_captura`). Se aplican en este
 * orden: quitar claves foráneas → crear índices → redefinir columnas → borrar
 * índices → añadir restricciones. Así ninguna clave foránea se queda sin índice.
 */
export const ordenarPlan = (sentencias: readonly string[]): string[] => {
    /** Posición de la sentencia en el orden de aplicación. */
    const fase = (sentencia: string): number => {
        if (/DROP FOREIGN KEY/.test(sentencia)) return 0;
        if (/^CREATE (UNIQUE )?INDEX|ADD UNIQUE INDEX/.test(sentencia)) return 1;
        if (/ CHANGE /.test(sentencia)) return 2;
        if (/^DROP INDEX|DROP INDEX|DROP CHECK/.test(sentencia)) return 3;
        return 4;
    };
    return sentencias
        .map((sentencia, indice) => ({ sentencia, indice, fase: fase(sentencia) }))
        .sort((a, b) => a.fase - b.fase || a.indice - b.indice)
        .map(({ sentencia }) => sentencia);
};

/** Definición actual de todas las columnas del esquema, para `clasificarPlan`. */
const leerColumnas = async (qr: QueryRunner): Promise<(tabla: string, columna: string) => DefinicionColumna | undefined> => {
    const filas: { tabla: string; columna: string; tipo: string; nula: string }[] = await qr.query(
        'SELECT table_name AS tabla, column_name AS columna, column_type AS tipo, is_nullable AS nula '
        + 'FROM information_schema.columns WHERE table_schema = DATABASE()',
    );
    const mapa = new Map(filas.map((fila) => [`${fila.tabla}.${fila.columna}`, { tipo: fila.tipo, nula: fila.nula === 'YES' }]));
    return (tabla, columna) => mapa.get(`${tabla}.${columna}`);
};

/** `true` si `admin.id_admin` todavía es un entero. */
const usaEnteros = async (qr: QueryRunner): Promise<boolean> => {
    const [columna] = await qr.query(
        "SELECT data_type AS tipo FROM information_schema.columns "
        + "WHERE table_schema = DATABASE() AND table_name = 'admin' AND column_name = 'id_admin'",
    );
    return /int/i.test(String(columna?.tipo ?? ''));
};

/** Lee lo que la fase A necesita, descifrando los nombres en memoria. */
const leerEstado = async (qr: QueryRunner, cifrado: DbFieldCipher): Promise<EstadoPrevio> => {
    /** Valor descifrado, o `null` si falta o no se puede descifrar. */
    const descifrar = (valor: string | null): string | null => {
        if (!valor) return null;
        try {
            return cifrado.decrypt(valor);
        } catch {
            return null;
        }
    };
    const claves = await qr.query(
        'SELECT DISTINCT table_name AS tabla, constraint_name AS nombre FROM information_schema.key_column_usage '
        + "WHERE table_schema = DATABASE() AND referenced_table_name = 'admin'",
    );
    const admins = await qr.query('SELECT id_admin AS id, username, email FROM admin');
    const correos = await qr.query('SELECT id_correo AS id, anadido_por AS autor FROM correo_permitido');
    const resolutores = await qr.query('SELECT DISTINCT resuelta_por AS nombre FROM alerta WHERE resuelta_por IS NOT NULL');
    const [tabla] = await qr.query(
        "SELECT table_collation AS colacion FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'admin'",
    );
    // Se interpola en el DDL, así que solo se admite un nombre de colación.
    if (!/^\w+$/.test(String(tabla?.colacion))) throw new Error('Colación de la tabla admin no reconocida');
    return {
        clavesHaciaAdmin: claves,
        admins: admins.map((fila: { id: number; username: string; email: string }) => ({
            id: Number(fila.id),
            username: descifrar(fila.username) ?? '',
            email: descifrar(fila.email) ?? '',
        })),
        correos: correos.map((fila: { id: number; autor: string | null }) => ({ id: Number(fila.id), autor: descifrar(fila.autor) })),
        resolutores: resolutores.map((fila: { nombre: string }) => fila.nombre),
        colacion: String(tabla.colacion),
    };
};

/** Muestra un paso sin sus parámetros: pueden llevar identificadores internos. */
const describir = (paso: Paso): string => (paso.params ? `${paso.sql}   [${paso.params.length} parámetros]` : paso.sql);

/** Ejecuta una lista de pasos en la misma conexión. */
const ejecutar = async (qr: QueryRunner, pasos: readonly Paso[]): Promise<void> => {
    for (const paso of pasos) {
        await qr.query(paso.sql, paso.params); // skipcq: JS-0032 — el orden de las sentencias DDL importa
    }
};

/** Punto de entrada. */
export const principal = async (): Promise<void> => {
    const aplicar = process.argv.includes('--aplicar');
    const db = container.resolve(DatabaseConfig);
    await db.initialize();
    const qr = db.dataSource.createQueryRunner();
    await qr.connect();
    try {
        if (await usaEnteros(qr)) {
            const pasos = planUuid(await leerEstado(qr, container.resolve(DbFieldCipher)));
            escribir(`Fase A — identificadores UUID (${pasos.length} sentencias):`);
            pasos.forEach((paso) => escribir(`  ${describir(paso)}`));
            if (!aplicar) {
                escribir('\nLa fase B se calcula después de aplicar la A. Ejecuta con --aplicar para migrar.');
                return;
            }
            await ejecutar(qr, pasos);
            escribir('Fase A aplicada.');
        } else {
            escribir('Fase A — los identificadores ya son UUID; nada que hacer.');
        }

        const renombres = planRenombres(indicesDeseados(db), await indicesExistentes(qr));
        escribir(`\nFase B — nombres de índice (${renombres.length} renombres):`);
        renombres.forEach((paso) => escribir(`  ${paso.sql}`));
        if (!aplicar) {
            if (renombres.length > 0) {
                escribir('\nEl resto de la fase B se calcula después de renombrar. Ejecuta con --aplicar para migrar.');
                return;
            }
        } else {
            await ejecutar(qr, renombres);
        }

        const { seguras, peligrosas } = clasificarPlan(await sentenciasDeDeriva(db), await leerColumnas(qr));
        if (peligrosas.length > 0) {
            escribir('\nFase B detenida: el plan incluye cambios de columnas que este script no aplica:');
            peligrosas.forEach((sentencia) => escribir(`  ${sentencia}`));
            process.exitCode = 1;
            return;
        }
        const ordenadas = ordenarPlan(seguras);
        escribir(`\nFase B — índices y restricciones (${ordenadas.length} sentencias):`);
        ordenadas.forEach((sentencia) => escribir(`  ${sentencia}`));
        if (aplicar && ordenadas.length > 0) {
            await ejecutar(qr, ordenadas.map((sql) => ({ sql })));
            escribir('Fase B aplicada.');
        }
    } finally {
        await qr.release();
        await db.destroy();
    }
};

if (require.main === module) {
    principal().catch((err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
