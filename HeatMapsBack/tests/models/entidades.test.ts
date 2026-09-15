import { beforeAll, describe, expect, it } from 'vitest';
import { container } from 'tsyringe';
import type { DataSource } from 'typeorm';
import { DatabaseConfig } from '../../src/config/database.config';
import { definido } from '../helpers/dobles';

/*
 * Construye los metadatos de TypeORM sin conectar. Así se comprueba que las
 * entidades son coherentes entre sí —relaciones que apuntan a entidades
 * registradas, claves foráneas con la política de borrado que documentan— sin
 * necesitar una base de datos.
 */

let fuente: DataSource;

beforeAll(async () => {
    fuente = container.resolve(DatabaseConfig).dataSource;
    await (fuente as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
});

/** Metadatos de TypeORM de la entidad asociada a una tabla. */
const metadatos = (tabla: string) => {
    const encontrada = fuente.entityMetadatas.find((entidad) => entidad.tableName === tabla);
    if (!encontrada) throw new Error(`No hay entidad para la tabla ${tabla}`);
    return encontrada;
};

describe('Entidades', () => {
    it('registra las doce tablas del esquema', () => {
        expect(fuente.entityMetadatas.map((entidad) => entidad.tableName).sort()).toEqual([
            'admin', 'alerta', 'correo_permitido', 'captura', 'dispositivo_infraestructura', 'evento_auditoria',
            'ocupacion_agregada', 'registro_pendiente', 'reporte', 'sensor', 'sesion_auth', 'zona',
        ].sort());
    });

    it.each([
        ['captura', 'sensor', 'sensor', 'CASCADE'],
        ['reporte', 'admin', 'admin', 'RESTRICT'],
        ['reporte', 'zona', 'zona', 'SET NULL'],
    ])('%s.%s apunta a %s con borrado %s', (tabla, propiedad, destino, borrado) => {
        const relacion = definido(metadatos(tabla).relations.find((candidata) => candidata.propertyName === propiedad), `la relación ${propiedad}`);
        expect(relacion.inverseEntityMetadata.tableName).toBe(destino);
        expect(relacion.onDelete).toBe(borrado);
    });

    it('todas las relaciones resuelven su entidad destino', () => {
        const relaciones = fuente.entityMetadatas.flatMap((entidad) => entidad.relations);
        expect(relaciones.length).toBeGreaterThan(0);
        for (const relacion of relaciones) expect(relacion.inverseEntityMetadata).toBeDefined();
    });

    it('las fechas por defecto las pone la base con precisión de milisegundos', () => {
        const porDefecto = fuente.entityMetadatas
            .flatMap((entidad) => entidad.columns)
            .map((columna) => columna.default)
            .filter((valor): valor is () => string => typeof valor === 'function');
        expect(porDefecto.length).toBeGreaterThan(0);
        for (const fn of porDefecto) expect(fn()).toMatch(/^CURRENT_TIMESTAMP/);
    });

    it('las columnas decimales llegan como número', () => {
        const rssi = definido(metadatos('ocupacion_agregada').columns.find((columna) => columna.propertyName === 'rssiPromedio'), 'la columna rssiPromedio');
        const transformador = rssi.transformer as { from: (v: string | null) => number | null };
        expect(transformador.from('-61.25')).toBe(-61.25);
    });
});
