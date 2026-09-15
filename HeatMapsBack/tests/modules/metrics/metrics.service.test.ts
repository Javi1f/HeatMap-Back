import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../../../src/modules/metrics/metrics.service';
import { NotFoundError } from '../../../src/common/errors';

/** Momento de hace `minutos` minutos. */
const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);

/** `MetricsService` con repositorios y configuración falsos. */
const crear = () => {
    const dobles = {
        capturas: { deteccionesDesde: vi.fn(() => Promise.resolve(120)) },
        presencia: { evaluar: vi.fn(() => Promise.resolve(new Map())) },
        ocupacion: { findLatestPerZone: vi.fn(() => Promise.resolve([] as unknown[])), findSeries: vi.fn(() => Promise.resolve([] as unknown[])) },
        sensores: { findAll: vi.fn(() => Promise.resolve([] as unknown[])) },
        zonas: { findActive: vi.fn(() => Promise.resolve([] as unknown[])) },
        alertas: { countUnresolved: vi.fn(() => Promise.resolve(2)), findUnresolved: vi.fn(() => Promise.resolve([{ idAlerta: 'a1' }])), resolve: vi.fn(() => Promise.resolve(true)) },
        cfg: { aggregationIntervalMinutes: 5, rssiReferenceDbm: -45, pathLossExponent: 2.7 },
    };
    const servicio = new MetricsService(
        dobles.capturas as never, dobles.presencia as never, dobles.ocupacion as never, dobles.sensores as never,
        dobles.zonas as never, dobles.alertas as never, dobles.cfg as never,
    );
    return { servicio, ...dobles };
};

let entorno: ReturnType<typeof crear>;
beforeEach(() => { entorno = crear(); });

describe('MetricsService.overview', () => {
    it('cuenta dispositivos presentes, randomizadas, RSSI medio y nodos en línea', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
        try {
            entorno.presencia.evaluar.mockResolvedValue(new Map([
                ['z1', { presentes: new Map([['a', { rssiMedio: -60, esMacRandom: true }], ['b', { rssiMedio: -71, esMacRandom: false }]]) }],
                ['z2', { presentes: new Map([['c', { rssiMedio: -65, esMacRandom: false }]]) }],
            ]));
            entorno.zonas.findActive.mockResolvedValue([{}, {}]);
            entorno.sensores.findAll.mockResolvedValue([
                { ultimaConexion: hace(1) },
                { ultimaConexion: hace(10) },
                { ultimaConexion: null },
            ]);

            await expect(entorno.servicio.overview()).resolves.toEqual({
                dispositivosAhora: 3,
                detecciones: 120,
                porcentajeRandomizadas: 33.3,
                rssiPromedio: -65.3,
                zonasActivas: 2,
                sensoresTotal: 3,
                sensoresEnLinea: 1,
                alertasAbiertas: 2,
                ventanaMinutos: 5,
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('sin nadie presente da 0 % y RSSI nulo, y reutiliza el resumen durante un segundo', async () => {
        await new Promise((resolver) => {
            setTimeout(resolver, 1_050);
        });
        const primero = await entorno.servicio.overview();
        expect(primero).toMatchObject({ dispositivosAhora: 0, porcentajeRandomizadas: 0, rssiPromedio: null });

        await entorno.servicio.overview();
        expect(entorno.presencia.evaluar).toHaveBeenCalledTimes(1);
    });
});

describe('MetricsService: zonas, series, nodos, alertas y parámetros', () => {
    it('muestra todas las zonas activas, en cero las que aún no tienen consolidación', async () => {
        const fin = new Date('2026-09-14T12:05:00Z');
        entorno.zonas.findActive.mockResolvedValue([
            { idZona: 'z1', nombre: 'Plazoleta', capacidadMax: 40 },
            { idZona: 'z2', nombre: 'Biblioteca', capacidadMax: null },
        ]);
        entorno.ocupacion.findLatestPerZone.mockResolvedValue([
            { idZona: 'z1', dispositivosUnicos: 10, dispositivosEstables: 6, rssiPromedio: -62.5, nivelOcupacion: 'media', intervaloFin: fin },
        ]);

        await expect(entorno.servicio.zones()).resolves.toEqual([
            { idZona: 'z1', nombre: 'Plazoleta', capacidadMax: 40, dispositivosUnicos: 10, dispositivosEstables: 6, rssiPromedio: -62.5, nivelOcupacion: 'media', porcentajeAforo: 25, actualizadoEn: fin.toISOString() },
            { idZona: 'z2', nombre: 'Biblioteca', capacidadMax: null, dispositivosUnicos: 0, dispositivosEstables: 0, rssiPromedio: null, nivelOcupacion: 'baja', porcentajeAforo: null, actualizadoEn: null },
        ]);
    });

    it.each([
        [0, 1],
        [6, 6],
        [1000, 168],
    ])('la serie de %s horas consulta %s horas hacia atrás', async (pedidas, efectivas) => {
        const antes = Date.now();
        await entorno.servicio.occupancySeries(pedidas, 'z1');
        const [desde, zona] = entorno.ocupacion.findSeries.mock.calls[0] as unknown as [Date, string];
        expect(Math.round((antes - desde.getTime()) / 3_600_000)).toBe(efectivas);
        expect(zona).toBe('z1');
    });

    it('proyecta los puntos de la serie', async () => {
        const inicio = new Date('2026-09-14T11:00:00Z');
        entorno.ocupacion.findSeries.mockResolvedValue([{ intervaloInicio: inicio, idZona: 'z1', dispositivosUnicos: 4, dispositivosEstables: 2, nivelOcupacion: 'baja', rssiPromedio: -70 }]);
        await expect(entorno.servicio.occupancySeries(6)).resolves.toEqual([
            { intervaloInicio: inicio.toISOString(), idZona: 'z1', dispositivosUnicos: 4, dispositivosEstables: 2, nivelOcupacion: 'baja' },
        ]);
    });

    it('calcula la salud de cada nodo', async () => {
        const reciente = hace(1);
        entorno.sensores.findAll.mockResolvedValue([
            { idSensor: 'n1', nombre: 'Nodo 1', zona: { nombre: 'Plazoleta' }, estado: 'activo', ultimaConexion: reciente },
            { idSensor: 'n2', nombre: 'Nodo 2', zona: null, estado: 'activo', ultimaConexion: hace(4) },
            { idSensor: 'n3', nombre: 'Nodo 3', estado: 'mantenimiento', ultimaConexion: null },
        ]);

        const salud = await entorno.servicio.sensorHealth();

        expect(salud[0]).toEqual({ idSensor: 'n1', nombre: 'Nodo 1', zona: 'Plazoleta', estado: 'activo', ultimaConexion: reciente.toISOString(), minutosDesdeUltimaLectura: 1, enLinea: true });
        expect(salud[1]).toMatchObject({ zona: null, minutosDesdeUltimaLectura: 4, enLinea: false });
        expect(salud[2]).toMatchObject({ zona: null, ultimaConexion: null, minutosDesdeUltimaLectura: null, enLinea: false });
    });

    it('lista y resuelve alertas', async () => {
        await expect(entorno.servicio.alerts()).resolves.toEqual([{ idAlerta: 'a1' }]);
        await entorno.servicio.resolveAlert('a1', 'raiz');
        expect(entorno.alertas.resolve).toHaveBeenCalledWith('a1', 'raiz');
        entorno.alertas.resolve.mockResolvedValue(false);
        await expect(entorno.servicio.resolveAlert('a1', 'raiz')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('expone los parámetros de sensado en vigor', () => {
        expect(entorno.servicio.parameters()).toEqual({ ventanaAgregacionMinutos: 5, rssiReferencia: -45, exponenteAtenuacion: 2.7 });
    });
});
