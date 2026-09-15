import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProcessorService } from '../../../src/modules/sensor/services/data-processor.service';
import { OccupancyAggregatorService } from '../../../src/modules/sensor/services/occupancy-aggregator.service';
import { PresenciaService } from '../../../src/modules/sensor/services/presencia.service';
import { definido, loggerFalso } from '../../helpers/dobles';

/* Todas las MAC de este archivo son sintéticas. */

/** Dispositivo tal como llega en una lectura del nodo. */
const dispositivo = (mac: string, rssi: number, extra: Record<string, unknown> = {}) => ({
    mac, rssi, channel: 6, type: 'probe', packets: 1, last_seen: '', randomized: false, ...extra,
});

/** Lectura normalizada de un nodo con los dispositivos indicados. */
const lectura = (devices: unknown[], sensor_id = 'nodo-1') => ({
    sensor_id, total_devices: devices.length, timestamp: '12:00:00', timestamp_raw: 1_789_000_000,
    bytes_received: 100, devices, received_at: '2026-09-14T12:00:00.000Z',
});

describe('DataProcessorService', () => {
    /** `DataProcessorService` con repositorios, anonimizador y estimador falsos. */
    const crear = () => {
        const dobles = {
            capturas: { insertMany: vi.fn((filas: unknown[]) => Promise.resolve(filas.length)) },
            sensores: { findById: vi.fn(() => Promise.resolve({ idSensor: 'nodo-1' })), create: vi.fn(), touch: vi.fn() },
            zonas: { findOrCreateDefault: vi.fn(() => Promise.resolve({ idZona: 'z0', nombre: 'Sin asignar' })) },
            anonymizer: { hash: vi.fn((mac: string) => `hash(${mac})`), isRandomized: vi.fn((mac: string) => mac.startsWith('02')) },
            distance: { estimate: vi.fn(() => 2.5) },
            presencia: { anotarInfraestructura: vi.fn() },
            logger: loggerFalso(),
        };
        const servicio = new DataProcessorService(
            dobles.capturas as never, dobles.sensores as never, dobles.zonas as never, dobles.anonymizer as never,
            dobles.distance as never, dobles.presencia as never, dobles.logger,
        );
        return { servicio, ...dobles };
    };

    it('ignora lecturas sin dispositivos', async () => {
        const entorno = crear();
        await entorno.servicio.processAndSave(lectura([]) as never);
        expect(entorno.capturas.insertMany).not.toHaveBeenCalled();
        expect(entorno.sensores.findById).not.toHaveBeenCalled();
    });

    it('persiste cada detección anonimizada, nunca la MAC en claro', async () => {
        const entorno = crear();
        await entorno.servicio.processAndSave(lectura([
            dispositivo('02:00:00:00:00:01', -61.8, { randomized: false }),
            dispositivo('10:00:00:00:00:02', -70, { channel: 'x', type: '' }),
            dispositivo('10:00:00:00:00:03', -72, { type: 'un-tipo-de-trama-demasiado-largo' }),
        ]) as never);

        const filas = entorno.capturas.insertMany.mock.calls[0][0] as Record<string, unknown>[];
        const momento = new Date(1_789_000_000 * 1000);
        expect(filas[0]).toEqual({
            macHash: 'hash(02:00:00:00:00:01)', idSensor: 'nodo-1', rssi: -61, distanciaEstimada: 2.5,
            canal: 6, tipoTrama: 'probe', esMacRandom: true, timestampCaptura: momento,
        });
        expect(filas[1]).toMatchObject({ canal: 0, tipoTrama: 'desconocido', esMacRandom: false });
        expect((filas[2].tipoTrama as string).length).toBe(20);
        expect(JSON.stringify(filas)).not.toMatch(/"macHash":"(?!hash\()/);
    });

    it('anota como infraestructura, ya anonimizada, lo que está pegado al nodo', async () => {
        const entorno = crear();
        await entorno.servicio.processAndSave(lectura([dispositivo('10:00:00:00:00:09', -25), dispositivo('10:00:00:00:aa:01', -80)]) as never);
        expect(entorno.presencia.anotarInfraestructura).toHaveBeenCalledWith(
            [{ macHash: 'hash(10:00:00:00:00:09)', motivo: 'junto-a-nodo' }],
            new Date(1_789_000_000 * 1000),
        );
    });

    it('registra un nodo nuevo en la zona «Sin asignar» una sola vez', async () => {
        const entorno = crear();
        entorno.sensores.findById.mockResolvedValue(null as never);

        await entorno.servicio.processAndSave(lectura([dispositivo('10:00:00:00:00:01', -60)], 'nodo-nuevo') as never);
        await entorno.servicio.processAndSave(lectura([dispositivo('10:00:00:00:00:01', -60)], 'nodo-nuevo') as never);

        expect(entorno.sensores.findById).toHaveBeenCalledTimes(1);
        expect(entorno.sensores.create).toHaveBeenCalledWith('nodo-nuevo', 'z0');
        expect(entorno.logger.info).toHaveBeenCalledOnce();
    });

    it('actualiza la última conexión como mucho cada 30 s por nodo', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
            const entorno = crear();
            const dispositivos = [dispositivo('10:00:00:00:00:01', -60)];

            await entorno.servicio.processAndSave(lectura(dispositivos) as never);
            await entorno.servicio.processAndSave(lectura(dispositivos) as never);
            await entorno.servicio.processAndSave(lectura(dispositivos, 'nodo-2') as never);
            vi.setSystemTime(new Date('2026-09-14T12:00:31Z'));
            await entorno.servicio.processAndSave(lectura(dispositivos) as never);

            expect(entorno.sensores.touch.mock.calls.map((llamada) => llamada[0])).toEqual(['nodo-1', 'nodo-2', 'nodo-1']);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('PresenciaService', () => {
    const cfg = { infraestructuraVigenciaHoras: 24, presenciaRssiMinimoDbm: -75 };
    /** `PresenciaService` con repositorios falsos. */
    const crear = () => {
        const dobles = {
            capturas: { senalesPorNodo: vi.fn(() => Promise.resolve([] as unknown[])) },
            infraestructura: { registrar: vi.fn(), vigentes: vi.fn(() => Promise.resolve(new Set<string>())) },
            logger: loggerFalso(),
        };
        return { servicio: new PresenciaService(dobles.capturas as never, dobles.infraestructura as never, cfg as never, dobles.logger), ...dobles };
    };

    afterEach(() => vi.useRealTimers());

    it('renueva cada dispositivo como mucho cada 10 minutos', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
        const entorno = crear();
        const momento = new Date();

        await entorno.servicio.anotarInfraestructura([{ macHash: 'a', motivo: 'punto-de-acceso' }], momento);
        await entorno.servicio.anotarInfraestructura([{ macHash: 'a', motivo: 'punto-de-acceso' }, { macHash: 'b', motivo: 'junto-a-nodo' }], momento);
        vi.setSystemTime(new Date('2026-09-14T12:10:00Z'));
        await entorno.servicio.anotarInfraestructura([{ macHash: 'a', motivo: 'punto-de-acceso' }], momento);

        expect(entorno.infraestructura.registrar.mock.calls.map((llamada) => (llamada[0] as { macHash: string }[]).map((fila) => fila.macHash)))
            .toEqual([['a'], ['b'], ['a']]);
    });

    it('no escribe si no hay nada que renovar', async () => {
        const entorno = crear();
        await entorno.servicio.anotarInfraestructura([], new Date());
        expect(entorno.infraestructura.registrar).not.toHaveBeenCalled();
    });

    it('un fallo al registrar se deja en el log y se reintenta en la siguiente lectura', async () => {
        const entorno = crear();
        entorno.infraestructura.registrar.mockRejectedValueOnce(new Error('bd'));

        await expect(entorno.servicio.anotarInfraestructura([{ macHash: 'a', motivo: 'manual' }], new Date())).resolves.toBeUndefined();
        await entorno.servicio.anotarInfraestructura([{ macHash: 'a', motivo: 'manual' }], new Date());

        expect(entorno.logger.error).toHaveBeenCalledOnce();
        expect(entorno.infraestructura.registrar).toHaveBeenCalledTimes(2);
    });

    it('vacía la memoria de renovaciones al superar su tope', async () => {
        const entorno = crear();
        const muchos = Array.from({ length: 5_001 }, (_, i) => ({ macHash: `m${i}`, motivo: 'manual' as const }));
        await entorno.servicio.anotarInfraestructura(muchos, new Date());
        await entorno.servicio.anotarInfraestructura([{ macHash: 'extra', motivo: 'manual' }], new Date());
        // Con la memoria llena se vacía antes de anotar: m0 vuelve a poder renovarse.
        await entorno.servicio.anotarInfraestructura([{ macHash: 'm0', motivo: 'manual' }], new Date());
        expect(entorno.infraestructura.registrar).toHaveBeenCalledTimes(3);
    });

    it('evalúa por zona excluyendo la infraestructura vigente', async () => {
        const entorno = crear();
        const hasta = new Date('2026-09-14T12:05:00Z');
        entorno.capturas.senalesPorNodo.mockResolvedValue([
            { idZona: 'z1', macHash: 'persona', idSensor: 'n1', rssi: -60, esMacRandom: false },
            { idZona: 'z1', macHash: 'router', idSensor: 'n1', rssi: -50, esMacRandom: false },
            { idZona: 'z2', macHash: 'lejos', idSensor: 'n9', rssi: -90, esMacRandom: true },
        ]);
        entorno.infraestructura.vigentes.mockResolvedValue(new Set(['router']));

        const evaluacion = await entorno.servicio.evaluar(new Date('2026-09-14T12:00:00Z'), hasta, 'z1');

        expect(entorno.infraestructura.vigentes).toHaveBeenCalledWith(new Date(hasta.getTime() - 24 * 3_600_000));
        expect(entorno.capturas.senalesPorNodo.mock.calls[0][2]).toBe('z1');
        expect([...evaluacion.keys()]).toEqual(['z1', 'z2']);
        const z1 = definido(evaluacion.get('z1'), 'la zona z1');
        expect([...z1.presentes.keys()]).toEqual(['persona']);
        expect(z1.descartadosInfraestructura).toBe(1);
        expect(definido(evaluacion.get('z2'), 'la zona z2').presentes.size).toBe(0);
    });
});

describe('OccupancyAggregatorService', () => {
    const cfg = { aggregationIntervalMinutes: 5, occupancyHighRatio: 0.8, occupancyMediumRatio: 0.5 };
    /** `n` dispositivos presentes, la mitad con MAC aleatoria. */
    const presentes = (cantidad: number) => new Map(Array.from({ length: cantidad }, (_, i) => [`d${i}`, { rssiMedio: -60.123, esMacRandom: i % 2 === 0 }]));

    /** `OccupancyAggregatorService` con repositorios falsos. */
    const crear = () => {
        const dobles = {
            ocupacion: { windowExists: vi.fn(() => Promise.resolve(false)), insertMany: vi.fn() },
            presencia: { evaluar: vi.fn(() => Promise.resolve(new Map())) },
            alertas: { hasOpenForZone: vi.fn(() => Promise.resolve(false)), create: vi.fn() },
            zonas: { findAll: vi.fn(() => Promise.resolve([] as unknown[])) },
            logger: loggerFalso(),
        };
        const servicio = new OccupancyAggregatorService(dobles.ocupacion as never, dobles.presencia as never, dobles.alertas as never, dobles.zonas as never, cfg as never, dobles.logger);
        return { servicio, ...dobles };
    };

    let entorno: ReturnType<typeof crear>;
    beforeEach(() => {
        entorno = crear();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-14T12:07:30Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('consolida la última ventana cerrada alineada al reloj', async () => {
        await entorno.servicio.runOnce();
        expect(entorno.ocupacion.windowExists).toHaveBeenCalledWith(new Date('2026-09-14T12:00:00Z'));
        expect(entorno.presencia.evaluar).toHaveBeenCalledWith(new Date('2026-09-14T12:00:00Z'), new Date('2026-09-14T12:05:00Z'));
    });

    it('no duplica una ventana ya consolidada', async () => {
        entorno.ocupacion.windowExists.mockResolvedValue(true);
        await entorno.servicio.runOnce();
        expect(entorno.presencia.evaluar).not.toHaveBeenCalled();
    });

    it('no inserta nada si ninguna zona tuvo detecciones', async () => {
        await entorno.servicio.runOnce();
        expect(entorno.ocupacion.insertMany).not.toHaveBeenCalled();
    });

    it('clasifica frente al aforo o, sin él, con umbrales absolutos', async () => {
        entorno.presencia.evaluar.mockResolvedValue(new Map([
            ['aforo-baja', { presentes: presentes(4) }],
            ['aforo-media', { presentes: presentes(5) }],
            ['aforo-alta', { presentes: presentes(8) }],
            ['libre-baja', { presentes: presentes(29) }],
            ['libre-media', { presentes: presentes(30) }],
            ['libre-alta', { presentes: presentes(60) }],
            ['vacia', { presentes: new Map() }],
        ]));
        entorno.zonas.findAll.mockResolvedValue([
            { idZona: 'aforo-baja', capacidadMax: 10 }, { idZona: 'aforo-media', capacidadMax: 10 }, { idZona: 'aforo-alta', capacidadMax: 10 },
            { idZona: 'libre-media', capacidadMax: null },
        ]);
        entorno.alertas.hasOpenForZone.mockResolvedValue(true);

        await entorno.servicio.runOnce();

        const filas = entorno.ocupacion.insertMany.mock.calls[0][0] as { idZona: string; nivelOcupacion: string; rssiPromedio: number | null; dispositivosEstables: number }[];
        expect(Object.fromEntries(filas.map((fila) => [fila.idZona, fila.nivelOcupacion]))).toEqual({
            'aforo-baja': 'baja', 'aforo-media': 'media', 'aforo-alta': 'alta',
            'libre-baja': 'baja', 'libre-media': 'media', 'libre-alta': 'alta', vacia: 'baja',
        });
        expect(filas[0]).toMatchObject({ rssiPromedio: -60.12, dispositivosEstables: 2 });
        expect(filas[filas.length - 1].rssiPromedio).toBeNull();
    });

    it('levanta una alerta por zona en nivel alto sin alerta abierta', async () => {
        entorno.presencia.evaluar.mockResolvedValue(new Map([
            ['plazoleta', { presentes: presentes(9) }],
            ['desconocida', { presentes: presentes(70) }],
            ['ya-avisada', { presentes: presentes(70) }],
        ]));
        entorno.zonas.findAll.mockResolvedValue([{ idZona: 'plazoleta', nombre: 'Plazoleta', capacidadMax: 10 }]);
        entorno.alertas.hasOpenForZone.mockImplementation((id: string) => Promise.resolve(id === 'ya-avisada'));

        await entorno.servicio.runOnce();

        expect(entorno.alertas.create).toHaveBeenCalledTimes(2);
        expect(entorno.alertas.create).toHaveBeenCalledWith('plazoleta', 'advertencia', 'Ocupación alta en Plazoleta: 9 dispositivos detectados sobre un aforo de 10.');
        expect(entorno.alertas.create).toHaveBeenCalledWith('desconocida', 'advertencia', 'Ocupación alta en zona desconocida: 70 dispositivos detectados.');
        expect(entorno.logger.warn).toHaveBeenCalledTimes(2);
    });

    it('arranca y detiene el temporizador de forma idempotente', async () => {
        vi.useRealTimers();
        vi.useFakeTimers();
        const espia = vi.spyOn(entorno.servicio, 'runOnce').mockRejectedValueOnce(new Error('bd')).mockResolvedValue();

        expect(entorno.servicio.running).toBe(false);
        entorno.servicio.start();
        entorno.servicio.start();
        expect(entorno.servicio.running).toBe(true);

        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(espia).toHaveBeenCalledTimes(1);
        expect(entorno.logger.error).toHaveBeenCalledWith('Fallo consolidando ocupación', expect.any(Error));

        entorno.servicio.stop();
        entorno.servicio.stop();
        expect(entorno.servicio.running).toBe(false);
        await vi.advanceTimersByTimeAsync(10 * 60_000);
        expect(espia).toHaveBeenCalledTimes(1);
        expect(entorno.logger.info).toHaveBeenCalledTimes(2);
    });
});
