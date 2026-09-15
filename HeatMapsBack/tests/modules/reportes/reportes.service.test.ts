import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportesService } from '../../../src/modules/reportes/reportes.service';
import { ReporteRepository } from '../../../src/modules/reportes/repositories/reporte.repository';
import { NotFoundError } from '../../../src/common/errors';
import { dbFalsa, repoTypeorm } from '../../helpers/dobles';

const INICIO = new Date('2026-09-01T00:00:00Z');
const FIN = new Date('2026-09-02T00:00:00Z');
const GENERADO = new Date('2026-09-03T00:00:00Z');

/** Definición de reporte guardada, del tipo indicado. */
const reporte = (tipoReporte: string, campos: Record<string, unknown> = {}) => ({
    idReporte: 'r1', tipoReporte, idZona: null, zona: null,
    rangoInicio: INICIO, rangoFin: FIN, fechaGeneracion: GENERADO, ...campos,
});

/** `ReportesService` con repositorios falsos. */
const crear = () => {
    const dobles = {
        reportes: { create: vi.fn(() => Promise.resolve({ idReporte: 'r1' })), findAll: vi.fn(), findById: vi.fn(), deleteById: vi.fn(() => Promise.resolve(true)) },
        ocupacion: { summaryByZone: vi.fn(() => Promise.resolve([] as unknown[])), findByRange: vi.fn(() => Promise.resolve([] as unknown[])) },
        alertas: { findByRange: vi.fn(() => Promise.resolve([] as unknown[])) },
        zonas: { findById: vi.fn() },
    };
    const servicio = new ReportesService(dobles.reportes as never, dobles.ocupacion as never, dobles.alertas as never, dobles.zonas as never);
    return { servicio, ...dobles };
};

let entorno: ReturnType<typeof crear>;
beforeEach(() => { entorno = crear(); });

describe('ReportesService', () => {
    it('rechaza crear un reporte de una zona inexistente', async () => {
        entorno.zonas.findById.mockResolvedValue(null);
        await expect(entorno.servicio.crear({ tipoReporte: 'alertas', rangoInicio: INICIO, rangoFin: FIN, idZona: 'nada' }, 1)).rejects.toBeInstanceOf(NotFoundError);
        expect(entorno.reportes.create).not.toHaveBeenCalled();
    });

    it('guarda la definición y la recalcula leyéndola de nuevo', async () => {
        entorno.zonas.findById.mockResolvedValue({ idZona: 'z1' });
        entorno.reportes.findById.mockResolvedValue(reporte('alertas', { idZona: 'z1', zona: { nombre: 'Plazoleta' } }));

        const resultado = await entorno.servicio.crear({ tipoReporte: 'alertas', rangoInicio: INICIO, rangoFin: FIN, idZona: 'z1' }, 7);

        expect(entorno.reportes.create).toHaveBeenCalledWith({
            idAdmin: 7, idZona: 'z1', tipoReporte: 'alertas', rangoInicio: INICIO, rangoFin: FIN,
            parametros: { tipoReporte: 'alertas', idZona: 'z1' },
        });
        expect(entorno.reportes.findById).toHaveBeenCalledWith('r1');
        expect(resultado.zona).toBe('Plazoleta');
    });

    it('sin zona, el reporte abarca todas', async () => {
        entorno.reportes.findById.mockResolvedValue(reporte('serie_temporal'));
        await entorno.servicio.crear({ tipoReporte: 'serie_temporal', rangoInicio: INICIO, rangoFin: FIN }, 7);
        expect(entorno.zonas.findById).not.toHaveBeenCalled();
        expect(entorno.reportes.create.mock.calls[0][0]).toMatchObject({ idZona: null, parametros: { idZona: null } });
    });

    it('lista definiciones sin calcular', async () => {
        entorno.reportes.findAll.mockResolvedValue([reporte('alertas', { zona: { nombre: 'P' } })]);
        await expect(entorno.servicio.listar()).resolves.toEqual([{
            idReporte: 'r1', tipoReporte: 'alertas', zona: 'P',
            rangoInicio: INICIO.toISOString(), rangoFin: FIN.toISOString(), fechaGeneracion: GENERADO.toISOString(),
        }]);
        expect(entorno.ocupacion.findByRange).not.toHaveBeenCalled();
    });

    it('obtener y eliminar uno inexistente dan 404', async () => {
        entorno.reportes.findById.mockResolvedValue(null);
        await expect(entorno.servicio.obtener('x')).rejects.toBeInstanceOf(NotFoundError);
        entorno.reportes.deleteById.mockResolvedValue(false);
        await expect(entorno.servicio.eliminar('x')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('elimina uno existente', async () => {
        await entorno.servicio.eliminar('r1');
        expect(entorno.reportes.deleteById).toHaveBeenCalledWith('r1');
    });

    it('resumen por zona', async () => {
        entorno.reportes.findById.mockResolvedValue(reporte('resumen_por_zona', { idZona: 'z1' }));
        entorno.ocupacion.summaryByZone.mockResolvedValue([{ nombre: 'Plazoleta', ventanas: 12, promedioUnicos: 4.5, picoUnicos: 9, promedioEstables: 2.1, ventanasAltas: 1 }]);

        const resultado = await entorno.servicio.obtener('r1');

        expect(entorno.ocupacion.summaryByZone).toHaveBeenCalledWith(INICIO, FIN, 'z1');
        expect(resultado.columnas).toEqual(['Zona', 'Ventanas', 'Promedio únicos', 'Pico únicos', 'Promedio estables', 'Ventanas en nivel alto']);
        expect(resultado.filas).toEqual([['Plazoleta', 12, 4.5, 9, 2.1, 1]]);
        expect(resultado.total).toBe(1);
    });

    it('alertas, con zona desconocida y estado legible', async () => {
        const cuando = new Date('2026-09-01T10:00:00Z');
        entorno.reportes.findById.mockResolvedValue(reporte('alertas'));
        entorno.alertas.findByRange.mockResolvedValue([
            { timestampAlerta: cuando, zona: { nombre: 'P' }, nivel: 'alta', mensaje: 'Aforo', resuelta: true },
            { timestampAlerta: cuando, zona: null, nivel: 'media', mensaje: 'Casi', resuelta: false },
        ]);

        const resultado = await entorno.servicio.obtener('r1');

        expect(resultado.filas).toEqual([
            [cuando.toISOString(), 'P', 'alta', 'Aforo', 'Resuelta'],
            [cuando.toISOString(), '—', 'media', 'Casi', 'Abierta'],
        ]);
    });

    it('serie temporal, con RSSI vacío si no hay dato', async () => {
        const cuando = new Date('2026-09-01T10:00:00Z');
        entorno.reportes.findById.mockResolvedValue(reporte('serie_temporal'));
        entorno.ocupacion.findByRange.mockResolvedValue([
            { intervaloInicio: cuando, zona: { nombre: 'P' }, dispositivosUnicos: 3, dispositivosEstables: 1, rssiPromedio: -61, nivelOcupacion: 'baja' },
            { intervaloInicio: cuando, zona: null, dispositivosUnicos: 0, dispositivosEstables: 0, rssiPromedio: null, nivelOcupacion: 'baja' },
        ]);

        const resultado = await entorno.servicio.obtener('r1');

        expect(resultado.columnas[0]).toBe('Inicio de ventana');
        expect(resultado.filas[1]).toEqual([cuando.toISOString(), '—', 0, 0, '', 'baja']);
    });

    it('exporta a CSV con BOM, CRLF y nombre por tipo y fecha', async () => {
        entorno.reportes.findById.mockResolvedValue(reporte('alertas'));
        entorno.alertas.findByRange.mockResolvedValue([
            { timestampAlerta: INICIO, zona: { nombre: 'P' }, nivel: 'alta', mensaje: 'Dijo "hola", y se fue', resuelta: false },
        ]);

        const { nombreArchivo, contenido } = await entorno.servicio.exportarCsv('r1');

        expect(nombreArchivo).toBe('alertas_2026-09-01.csv');
        expect(contenido.startsWith('﻿"Fecha","Zona","Nivel","Mensaje","Estado"\r\n')).toBe(true);
        expect(contenido).toContain('"Dijo ""hola"", y se fue"');
        expect(contenido.endsWith('\r\n')).toBe(true);
    });
});

describe('ReporteRepository', () => {
    it('guarda, lista con la zona, busca y borra', async () => {
        const repo = repoTypeorm();
        const repositorio = new ReporteRepository(dbFalsa(repo));
        const datos = { idAdmin: 1, idZona: null, tipoReporte: 'alertas', rangoInicio: INICIO, rangoFin: FIN, parametros: null };

        await repositorio.create(datos);
        await repositorio.findAll();
        await repositorio.findById('r1');

        expect(repo.save).toHaveBeenCalledWith(datos);
        expect(repo.find).toHaveBeenCalledWith({ relations: { zona: true }, order: { fechaGeneracion: 'DESC' } });
        expect(repo.findOne).toHaveBeenCalledWith({ where: { idReporte: 'r1' }, relations: { zona: true } });

        repo.delete.mockResolvedValueOnce({ affected: 1 });
        await expect(repositorio.deleteById('r1')).resolves.toBe(true);
        repo.delete.mockResolvedValueOnce({} as never);
        await expect(repositorio.deleteById('r1')).resolves.toBe(false);
    });
});
