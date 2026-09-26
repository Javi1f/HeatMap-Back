import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { DatabaseConfig } from '../../src/config/database.config';
import { DbFieldCipher } from '../../src/crypto/db-field.crypto';
import { principal as deriva } from '../../src/scripts/deriva-esquema';
import {
    clasificarPlan,
    EstadoPrevio,
    IndiceDef,
    ordenarPlan,
    planRenombres,
    planUuid,
    principal as migrar,
    REFERENCIAS_A_ADMIN,
} from '../../src/scripts/migrar-esquema';

const COLACION = 'utf8mb4_0900_ai_ci';

/** Generador de UUID predecible: u1, u2, u3… */
const secuencia = () => {
    let n = 0;
    return () => `u${++n}`;
};

/** Estado con dos cuentas, dos correos y dos resolutores (uno sin cuenta). */
const ESTADO: EstadoPrevio = {
    clavesHaciaAdmin: [{ tabla: 'sesion_auth', nombre: 'FK_viejo' }],
    admins: [
        { id: 1, username: 'Ana', email: 'ana@unbosque.edu.co' },
        { id: 2, username: 'beto', email: 'beto@unbosque.edu.co' },
    ],
    correos: [
        { id: 10, autor: ' ANA ' },
        { id: 11, autor: null },
    ],
    resolutores: ['beto@unbosque.edu.co', 'fantasma'],
    colacion: COLACION,
};

describe('planUuid', () => {
    const pasos = planUuid(ESTADO, secuencia());
    const sql = pasos.map((paso) => paso.sql);
    /** Pasos cuya sentencia contiene el texto. */
    const con = (patron: string) => pasos.filter((paso) => paso.sql.includes(patron));

    it('desactiva las claves foráneas solo mientras dura y quita las que apuntan a admin', () => {
        expect(sql[0]).toBe('SET FOREIGN_KEY_CHECKS = 0');
        expect(sql.at(-1)).toBe('SET FOREIGN_KEY_CHECKS = 1');
        expect(sql).toContain('ALTER TABLE `sesion_auth` DROP FOREIGN KEY `FK_viejo`');
    });

    it('asigna un UUID a cada cuenta y lo propaga a todas sus referencias', () => {
        expect(con('UPDATE `admin`').map((paso) => paso.params)).toEqual([['u1', 1], ['u2', 2]]);
        for (const ref of REFERENCIAS_A_ADMIN) {
            const actualizaciones = pasos.filter((paso) => paso.sql.startsWith(`UPDATE \`${ref.tabla}\``));
            expect(actualizaciones.map((paso) => paso.params)).toEqual([['u1', 1], ['u2', 2]]);
            expect(sql).toContain(`ALTER TABLE \`${ref.tabla}\` DROP COLUMN \`${ref.columna}\`, `
                + `CHANGE \`${ref.columna}_nueva\` \`${ref.columna}\` CHAR(36) COLLATE ${COLACION} ${ref.nula ? 'NULL' : 'NOT NULL'}`);
        }
    });

    it('enlaza el autor de cada correo por nombre o correo, sin distinguir mayúsculas ni espacios', () => {
        expect(con('UPDATE `correo_permitido`').map((paso) => paso.params)).toEqual([['u3', 'u1', 10], ['u4', null, 11]]);
    });

    it('convierte quien resolvió cada alerta en su cuenta y deja en NULL a quien no tiene cuenta', () => {
        expect(con('UPDATE `alerta`').map((paso) => paso.params)).toEqual([['u2', 'beto@unbosque.edu.co']]);
    });

    it('crea todas las columnas nuevas con la colación de admin', () => {
        const columnas = sql.filter((sentencia) => /CHAR\(36\)/.test(sentencia));
        expect(columnas.length).toBeGreaterThan(0);
        expect(columnas.every((sentencia) => sentencia.includes(`CHAR(36) COLLATE ${COLACION}`))).toBe(true);
    });

    it('usa randomUUID si no se inyecta un generador', () => {
        const [, actualizacion] = planUuid({ ...ESTADO, clavesHaciaAdmin: [] }).filter((paso) => paso.sql.startsWith('UPDATE `admin`'));
        expect(String(actualizacion.params?.[0])).toMatch(/^[0-9a-f-]{36}$/);
    });
});

describe('clasificarPlan', () => {
    /** Solo `admin.email_hash` existe en la base simulada. */
    const columnas = (tabla: string, columna: string) =>
        (tabla === 'admin' && columna === 'email_hash' ? { tipo: 'char(64)', nula: false } : undefined);

    it('acepta índices, restricciones y redefiniciones idénticas; rechaza lo demás', () => {
        const { seguras, peligrosas } = clasificarPlan([
            'DROP INDEX `IDX_1` ON `admin`',
            'CREATE UNIQUE INDEX `uq_x` ON `admin` (`email_hash`)',
            'ALTER TABLE `alerta` ADD CONSTRAINT `fk_alerta_resuelta_por` FOREIGN KEY (`resuelta_por`) REFERENCES `admin`(`id_admin`)',
            'ALTER TABLE `reporte` DROP CHECK `chk_viejo`',
            'ALTER TABLE `admin` CHANGE `email_hash` `email_hash` CHAR(64) NOT NULL',
            'ALTER TABLE `admin` CHANGE `email_hash` `email_hash` CHAR(64) NULL',
            'ALTER TABLE `admin` CHANGE `email_hash` `correo` CHAR(64) NOT NULL',
            'ALTER TABLE `admin` CHANGE `otra` `otra` INT NOT NULL',
            'ALTER TABLE `admin` DROP COLUMN `rol`',
        ], columnas);
        expect(seguras).toHaveLength(5);
        expect(peligrosas).toEqual([
            'ALTER TABLE `admin` CHANGE `email_hash` `email_hash` CHAR(64) NULL',
            'ALTER TABLE `admin` CHANGE `email_hash` `correo` CHAR(64) NOT NULL',
            'ALTER TABLE `admin` CHANGE `otra` `otra` INT NOT NULL',
            'ALTER TABLE `admin` DROP COLUMN `rol`',
        ]);
    });

    it('sin definiciones de columna ninguna redefinición es segura', () => {
        expect(clasificarPlan(['ALTER TABLE `admin` CHANGE `a` `a` INT NULL']).peligrosas).toHaveLength(1);
    });
});

describe('ordenarPlan', () => {
    it('crea antes de borrar para que ninguna clave foránea se quede sin índice', () => {
        expect(ordenarPlan([
            'ALTER TABLE `captura` ADD CONSTRAINT `fk_captura_sensor` FOREIGN KEY (`id_sensor`) REFERENCES `sensor`(`id_sensor`)',
            'DROP INDEX `IDX_suelto` ON `captura`',
            'ALTER TABLE `admin` CHANGE `a` `a` INT NULL',
            'CREATE INDEX `idx_captura_sensor_timestamp` ON `captura` (`id_sensor`, `timestamp_captura`)',
            'ALTER TABLE `captura` DROP FOREIGN KEY `FK_viejo`',
            'CREATE INDEX `idx_b` ON `captura` (`b`)',
        ])).toEqual([
            'ALTER TABLE `captura` DROP FOREIGN KEY `FK_viejo`',
            'CREATE INDEX `idx_captura_sensor_timestamp` ON `captura` (`id_sensor`, `timestamp_captura`)',
            'CREATE INDEX `idx_b` ON `captura` (`b`)',
            'ALTER TABLE `admin` CHANGE `a` `a` INT NULL',
            'DROP INDEX `IDX_suelto` ON `captura`',
            'ALTER TABLE `captura` ADD CONSTRAINT `fk_captura_sensor` FOREIGN KEY (`id_sensor`) REFERENCES `sensor`(`id_sensor`)',
        ]);
    });
});

describe('planRenombres', () => {
    /** Índice sobre las columnas dadas. */
    const indice = (tabla: string, nombre: string, columnas: string, unico = false): IndiceDef => ({ tabla, nombre, columnas, unico });

    it('renombra el índice equivalente con nombre autogenerado, una sola vez', () => {
        const pasos = planRenombres(
            [
                indice('admin', 'uq_admin_email_hash', 'email_hash', true),
                indice('admin', 'uq_admin_username_hash', 'username_hash', true),
                indice('captura', 'idx_captura_timestamp', 'timestamp_captura'),
                indice('captura', 'idx_captura_timestamp_2', 'timestamp_captura'),
                indice('sensor', 'idx_sensor_zona', 'id_zona'),
            ],
            [
                indice('admin', 'IDX_email', 'email_hash', true),
                indice('admin', 'uq_admin_username_hash', 'username_hash', true),
                indice('captura', 'IDX_ts', 'timestamp_captura'),
                indice('sensor', 'IDX_zona_unico', 'id_zona', true),
            ],
        );
        expect(pasos.map((paso) => paso.sql)).toEqual([
            'ALTER TABLE `admin` RENAME INDEX `IDX_email` TO `uq_admin_email_hash`',
            'ALTER TABLE `captura` RENAME INDEX `IDX_ts` TO `idx_captura_timestamp`',
        ]);
    });

    it('no toma un índice que ya tiene un nombre declarado', () => {
        expect(planRenombres(
            [indice('t', 'idx_a', 'x'), indice('t', 'idx_b', 'x')],
            [indice('t', 'idx_b', 'x')],
        )).toEqual([]);
    });
});

/* ---------- Ejecución contra una base simulada ---------- */

/** Estado de la base simulada y lo que ha recibido. */
interface Base {
    entero: boolean;
    estadisticas: Record<string, unknown>[];
    deriva: string[];
    consultas: { sql: string; params?: unknown[] }[];
}

let base: Base;
let salida: string[];
let argvOriginal: string[];

/** Respuesta de la base simulada a cada consulta de lectura. */
const responder = (sql: string): unknown[] => {
    if (sql.includes('data_type AS tipo')) return [{ tipo: base.entero ? 'int' : 'char' }];
    if (sql.includes('key_column_usage')) return [{ tabla: 'sesion_auth', nombre: 'FK_viejo' }];
    if (sql.startsWith('SELECT id_admin')) return [{ id: '1', username: 'cifrado:ana', email: 'cifrado:ana@x.co' }];
    if (sql.startsWith('SELECT id_correo')) return [{ id: '4', autor: 'cifrado:ana' }, { id: '5', autor: 'roto' }, { id: '6', autor: null }];
    if (sql.includes('resuelta_por AS nombre')) return [{ nombre: 'ana' }];
    if (sql.includes('table_collation')) return [{ colacion: COLACION }];
    if (sql.includes('information_schema.statistics')) return base.estadisticas;
    if (sql.includes('information_schema.columns')) return [{ tabla: 'admin', columna: 'a', tipo: 'int', nula: 'YES' }];
    return [];
};

/** Registra una base simulada y un cifrador que solo sabe descifrar lo marcado. */
const registrarBase = () => {
    const qr = {
        connect: vi.fn(),
        release: vi.fn(),
        query: vi.fn((sql: string, params?: unknown[]) => {
            base.consultas.push({ sql, params });
            return Promise.resolve(responder(sql));
        }),
    };
    const db = {
        initialize: vi.fn(),
        destroy: vi.fn(),
        dataSource: {
            createQueryRunner: () => qr,
            entityMetadatas: [{
                tableName: 'admin',
                indices: [{ name: 'idx_admin_rol', isUnique: false, columns: [{ databaseName: 'rol' }] }],
                uniques: [{ name: 'uq_admin_email_hash', columns: [{ databaseName: 'email_hash' }] }],
            }],
            driver: {
                createSchemaBuilder: () => ({
                    log: () => Promise.resolve({ upQueries: base.deriva.map((query) => ({ query })) }),
                }),
            },
        },
    };
    container.registerInstance(DatabaseConfig, db as never);
    container.registerInstance(DbFieldCipher, {
        decrypt: (valor: string) => {
            if (!valor.startsWith('cifrado:')) throw new Error('no descifra');
            return valor.slice('cifrado:'.length);
        },
    } as never);
    return { db, qr };
};

/** Sentencias de escritura que llegaron a la base. */
const escrituras = () => base.consultas.filter((consulta) => !consulta.sql.startsWith('SELECT')).map((consulta) => consulta.sql);

beforeEach(() => {
    base = { entero: true, estadisticas: [], deriva: [], consultas: [] };
    salida = [];
    argvOriginal = process.argv;
    process.argv = ['node', 'script'];
    process.exitCode = undefined;
    vi.spyOn(process.stdout, 'write').mockImplementation((texto) => {
        salida.push(String(texto));
        return true;
    });
});

afterEach(() => {
    process.argv = argvOriginal;
    process.exitCode = undefined;
    container.clearInstances();
    vi.restoreAllMocks();
});

describe('bd:migrar', () => {
    it('sin --aplicar muestra la fase A sin parámetros y no escribe nada', async () => {
        const { db, qr } = registrarBase();
        await migrar();
        expect(escrituras()).toEqual([]);
        const texto = salida.join('');
        expect(texto).toContain('Fase A — identificadores UUID');
        expect(texto).toContain('[2 parámetros]');
        expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
        expect(qr.release).toHaveBeenCalled();
        expect(db.destroy).toHaveBeenCalled();
    });

    it('con --aplicar ejecuta la fase A con los autores descifrados y sigue con la B', async () => {
        process.argv.push('--aplicar');
        base.estadisticas = [{ tabla: 'admin', nombre: 'IDX_1', columnas: 'email_hash', unico: 1 }];
        base.deriva = ['CREATE INDEX `idx_admin_rol` ON `admin` (`rol`)', 'ALTER TABLE `admin` DROP FOREIGN KEY `FK_x`'];
        registrarBase();
        await migrar();

        const correos = base.consultas.filter((consulta) => consulta.sql.startsWith('UPDATE `correo_permitido`'));
        expect(correos.map((consulta) => consulta.params?.slice(1))).toEqual([[expect.any(String), 4], [null, 5], [null, 6]]);
        const escrito = escrituras();
        expect(escrito).toContain('ALTER TABLE `admin` RENAME INDEX `IDX_1` TO `uq_admin_email_hash`');
        expect(escrito.slice(-2)).toEqual(['ALTER TABLE `admin` DROP FOREIGN KEY `FK_x`', 'CREATE INDEX `idx_admin_rol` ON `admin` (`rol`)']);
        expect(salida.join('')).toContain('Fase B aplicada.');
    });

    it('con los ids ya en UUID y renombres pendientes, sin --aplicar se detiene tras listarlos', async () => {
        base.entero = false;
        base.estadisticas = [{ tabla: 'admin', nombre: 'IDX_1', columnas: 'email_hash', unico: '1' }];
        registrarBase();
        await migrar();
        const texto = salida.join('');
        expect(texto).toContain('ya son UUID');
        expect(texto).toContain('RENAME INDEX `IDX_1`');
        expect(texto).toContain('El resto de la fase B se calcula después de renombrar');
        expect(escrituras()).toEqual([]);
    });

    it('se detiene sin ejecutar nada si el plan toca columnas', async () => {
        process.argv.push('--aplicar');
        base.entero = false;
        base.deriva = ['CREATE INDEX `i` ON `admin` (`rol`)', 'ALTER TABLE `admin` DROP COLUMN `rol`'];
        registrarBase();
        await migrar();
        expect(process.exitCode).toBe(1);
        expect(salida.join('')).toContain('Fase B detenida');
        expect(escrituras()).toEqual([]);
    });

    it('sin nada pendiente no escribe', async () => {
        base.entero = false;
        registrarBase();
        await migrar();
        expect(salida.join('')).toContain('índices y restricciones (0 sentencias)');
        expect(escrituras()).toEqual([]);
    });

    it('rechaza una colación que no es un nombre simple', async () => {
        const { qr } = registrarBase();
        qr.query.mockImplementation((sql: string) =>
            Promise.resolve(sql.includes('table_collation') ? [{ colacion: 'x; DROP TABLE admin' }] : responder(sql)));
        await expect(migrar()).rejects.toThrow('Colación de la tabla admin no reconocida');
        expect(qr.release).toHaveBeenCalled();
    });
});

describe('bd:deriva', () => {
    it('sin diferencias termina bien', async () => {
        const { db } = registrarBase();
        await deriva();
        expect(salida.join('')).toContain('Sin deriva');
        expect(process.exitCode).toBeUndefined();
        expect(db.destroy).toHaveBeenCalled();
    });

    it('con diferencias las lista y termina con código 1', async () => {
        base.deriva = ['ALTER TABLE `admin` DROP COLUMN `rol`'];
        registrarBase();
        await deriva();
        expect(salida.join('')).toContain('1 diferencias');
        expect(process.exitCode).toBe(1);
    });
});
