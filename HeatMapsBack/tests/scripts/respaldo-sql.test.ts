import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import {
    crearTablaEnUnaLinea,
    esSentencia,
    leerManifiesto,
    lineaManifiesto,
    sentenciaInsert,
} from '../../src/scripts/respaldo-sql';

describe('formato de respaldo', () => {
    it('compacta el CREATE TABLE en una línea idempotente', () => {
        const sql = 'CREATE TABLE `zona` (\n  `id_zona` varchar(36) NOT NULL,\n  PRIMARY KEY (`id_zona`)\n) ENGINE=InnoDB';
        const resultado = crearTablaEnUnaLinea(sql);
        expect(resultado.startsWith('CREATE TABLE IF NOT EXISTS `zona`')).toBe(true);
        expect(resultado).not.toContain('\n');
        expect(resultado.endsWith(';')).toBe(true);
    });

    it('genera un INSERT de una sola línea aunque los valores tengan saltos y comillas', () => {
        const sql = sentenciaInsert(
            'zona',
            ['id', 'descripcion', 'vacio'],
            [{ id: 1, descripcion: "Plazoleta\ncon 'comillas'; y punto y coma", vacio: null }],
            mysql.escape,
        );
        expect(sql).not.toContain('\n');
        expect(sql).toBe("INSERT INTO `zona` (`id`, `descripcion`, `vacio`) VALUES (1, 'Plazoleta\\ncon \\'comillas\\'; y punto y coma', NULL);");
    });

    it('escribe y lee el manifiesto', () => {
        expect(leerManifiesto(lineaManifiesto('captura', 1234))).toEqual({ tabla: 'captura', filas: 1234 });
        expect(leerManifiesto('-- comentario cualquiera')).toBeNull();
        expect(leerManifiesto('-- filas captura muchas')).toBeNull();
    });

    it('distingue sentencias de comentarios y líneas vacías', () => {
        expect(esSentencia('SET NAMES utf8mb4;')).toBe(true);
        expect(esSentencia('   ')).toBe(false);
        expect(esSentencia('-- filas zona 3')).toBe(false);
    });
});
