import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    CotizacionRepositoryArchivo,
    rutaSolicitudesArchivo,
    escribirSolicitudesArchivo,
    leerSolicitudesArchivo,
} from '../../src/persistencia/repositorios/cotizacion.repository-archivo';
import type { SolicitudCotizacionInsert } from '../../src/persistencia/repositorios/cotizacion.repository';

/**
 * Solicitud de ejemplo tal como la deja el servicio: el correo ya viene
 * cifrado y el repositorio no lo toca.
 */
const insert = (): SolicitudCotizacionInsert => ({
    tipoRecinto: 'plaza-publica',
    organizacion: 'Plaza de Mercados La Central',
    nombreContacto: 'María Pérez',
    correoContacto: 'enc(maria@plazalacentral.co)',
    telefonoContacto: null,
    areaM2: 3200,
    aforoMinimo: 800,
    aforoMaximo: 2500,
    eventosAnuales: 48,
    datos: { version: 1 },
    estimacion: { nodos: 10, desglose: [], integraciones: [], notas: [] },
    ipOrigen: '191.95.18.44',
});

/** Ruta temporal única por prueba: cada `it` parte de un archivo propio. */
let ruta: string;

beforeEach(() => {
    ruta = join(fs.mkdtempSync(join(tmpdir(), 'cotizacion-demo-')), 'solicitudes.json');
});

describe('CotizacionRepositoryArchivo', () => {
    it('guarda la solicitud tal cual llega y la relee del archivo', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        const fila = await repositorio.create(insert());

        expect(fila.idSolicitud).toMatch(/[0-9a-f-]{36}/);
        expect(fila.estado).toBe('nueva');
        expect(fila.fechaCreacion).toBeInstanceOf(Date);
        expect(fila.correoContacto).toBe('enc(maria@plazalacentral.co)');

        const contenido = fs.readFileSync(ruta, 'utf8');
        expect(contenido).toContain('enc(maria@plazalacentral.co)');
        expect(JSON.parse(contenido).formato).toBe('solicitudes-cotizacion');
        expect((await repositorio.findAll()).length).toBe(1);
    });

    it('ordena del más reciente hacia atrás y filtra por estado', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        for (let i = 0; i < 3; i += 1) {
            await repositorio.create({ ...insert(), organizacion: `Recinto ${i}` });
        }

        // Tres fechas distintas para que el orden sea observable, y un estado
        // que el filtro deba aislar.
        const filas = leerSolicitudesArchivo(ruta);
        filas[0].fechaCreacion = new Date('2026-10-27T12:00:00Z');
        filas[1].fechaCreacion = new Date('2026-10-25T12:00:00Z');
        filas[1].estado = 'contactada';
        filas[2].fechaCreacion = new Date('2026-10-20T12:00:00Z');
        escribirSolicitudesArchivo(filas, ruta);

        const todas = await repositorio.findAll();
        expect(todas.map((f) => f.organizacion)).toEqual([
            'Recinto 0',
            'Recinto 1',
            'Recinto 2',
        ]);

        const contactadas = await repositorio.findAll('contactada');
        expect(contactadas).toHaveLength(1);
        expect(contactadas[0].organizacion).toBe('Recinto 1');
    });

    it('busca por id y distingue el id que no existe', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        const fila = await repositorio.create(insert());

        await expect(repositorio.findById(fila.idSolicitud)).resolves.toMatchObject({
            organizacion: 'Plaza de Mercados La Central',
        });
        await expect(repositorio.findById('no-existe')).resolves.toBeNull();
    });

    it('actualiza estado y notas, y devuelve false si la solicitud no existe', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        const fila = await repositorio.create(insert());

        await expect(
            repositorio.actualizar(fila.idSolicitud, {
                estado: 'contactada',
                notasComerciales: 'Llamada agendada',
            }),
        ).resolves.toBe(true);

        const actualizada = await repositorio.findById(fila.idSolicitud);
        expect(actualizada?.estado).toBe('contactada');
        expect(actualizada?.notasComerciales).toBe('Llamada agendada');
        expect(actualizada?.fechaActualizacion.getTime()).toBeGreaterThanOrEqual(
            fila.fechaActualizacion.getTime(),
        );

        await expect(
            repositorio.actualizar('no-existe', { estado: 'cerrada' }),
        ).resolves.toBe(false);
    });

    it('elimina y avisa cuando el id no estaba', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        const fila = await repositorio.create(insert());

        await expect(repositorio.deleteById('no-existe')).resolves.toBe(false);
        await expect(repositorio.deleteById(fila.idSolicitud)).resolves.toBe(true);
        await expect(repositorio.findById(fila.idSolicitud)).resolves.toBeNull();
        expect(await repositorio.findAll()).toHaveLength(0);
    });

    it('un archivo que no existe es un almacén vacío, no un error', async () => {
        const repositorio = new CotizacionRepositoryArchivo(ruta);
        await expect(repositorio.findAll()).resolves.toEqual([]);
        await expect(repositorio.findById('lo-que-sea')).resolves.toBeNull();
        await expect(repositorio.deleteById('lo-que-sea')).resolves.toBe(false);
    });

    it('dos instancias del repositorio ven el mismo archivo', async () => {
        const primera = new CotizacionRepositoryArchivo(ruta);
        await primera.create(insert());

        const segunda = new CotizacionRepositoryArchivo(ruta);
        await expect(segunda.findAll()).resolves.toHaveLength(1);
    });

    it('la ruta por defecto vive en datos-demo del proyecto', () => {
        expect(rutaSolicitudesArchivo()).toContain('datos-demo');
        expect(rutaSolicitudesArchivo()).toMatch(/solicitudes-cotizacion\.json$/);
    });
});
