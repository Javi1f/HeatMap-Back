import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsController } from '../../src/modules/metrics/metrics.controller';
import { PublicoController } from '../../src/modules/publico/publico.controller';
import { ReportesController } from '../../src/modules/reportes/reportes.controller';
import { SensorController } from '../../src/modules/sensor/sensor.controller';
import { UnauthorizedError, ValidationError } from '../../src/common/errors';
import { MESSAGES } from '../../src/constants/messages';
import { reqFalsa, resFalsa } from '../helpers/dobles';

const ADMIN = { id: 1, username: 'raiz', email: 'r@b.co' };

describe('MetricsController', () => {
    let servicio: Record<string, ReturnType<typeof vi.fn>>;
    let ctrl: MetricsController;

    beforeEach(() => {
        servicio = {
            overview: vi.fn(() => Promise.resolve({ dispositivosAhora: 3 })),
            zones: vi.fn(() => Promise.resolve([])),
            occupancySeries: vi.fn(() => Promise.resolve([])),
            sensorHealth: vi.fn(() => Promise.resolve([])),
            alerts: vi.fn(() => Promise.resolve([])),
            resolveAlert: vi.fn(),
            parameters: vi.fn(() => ({ ventanaAgregacionMinutos: 5 })),
        };
        ctrl = new MetricsController(servicio as never);
    });

    it.each([
        ['overview', 'overview'],
        ['zones', 'zones'],
        ['sensors', 'sensorHealth'],
        ['alerts', 'alerts'],
    ] as const)('%s responde con los datos del servicio', async (metodo, delegado) => {
        const res = resFalsa();
        await ctrl[metodo](reqFalsa(), res);
        expect(servicio[delegado]).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
        expect(res.cuerpo).toMatchObject({ success: true });
    });

    it.each([
        [{ hours: '12', zoneId: 'z1' }, 12, 'z1'],
        [{ hours: 'abc' }, 6, undefined],
        [{ hours: '-3', zoneId: ['z1', 'z2'] }, 6, undefined],
        [{}, 6, undefined],
    ])('occupancy con %j pide %s horas de la zona %s', async (query, horas, zona) => {
        await ctrl.occupancy(reqFalsa({ query }), resFalsa());
        expect(servicio.occupancySeries).toHaveBeenCalledWith(horas, zona);
    });

    it('resuelve una alerta a nombre del admin autenticado', async () => {
        const res = resFalsa();
        await ctrl.resolveAlert(reqFalsa({ admin: ADMIN, params: { id: 'a1' } }), res);
        expect(servicio.resolveAlert).toHaveBeenCalledWith('a1', 'raiz');
        expect(res.cuerpo).toEqual({ success: true, message: 'Alerta resuelta' });
        await expect(ctrl.resolveAlert(reqFalsa(), resFalsa())).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('devuelve los parámetros sin esperar', () => {
        const res = resFalsa();
        ctrl.parameters(reqFalsa(), res);
        expect(res.cuerpo).toEqual({ success: true, data: { ventanaAgregacionMinutos: 5 } });
    });
});

describe('PublicoController', () => {
    const servicio = { listarZonas: vi.fn(() => Promise.resolve([{ nombre: 'P' }])), mapa: vi.fn(() => Promise.resolve({ nombre: 'P' })) };
    const ctrl = new PublicoController(servicio as never);

    beforeEach(() => servicio.mapa.mockClear());

    it('lista zonas', async () => {
        const res = resFalsa();
        await ctrl.zonas(reqFalsa(), res);
        expect(res.cuerpo).toEqual({ success: true, data: [{ nombre: 'P' }] });
    });

    it.each([{}, { zonaId: '' }, { zonaId: ['a'] }])('el mapa exige zonaId (%j)', async (query) => {
        await expect(ctrl.mapa(reqFalsa({ query }), resFalsa())).rejects.toBeInstanceOf(ValidationError);
    });

    it.each([
        [{ zonaId: 'z', minutos: '15' }, 15],
        [{ zonaId: 'z', minutos: 'x' }, 5],
        [{ zonaId: 'z', minutos: '0' }, 5],
    ])('el mapa con %j usa %s minutos', async (query, minutos) => {
        const res = resFalsa();
        await ctrl.mapa(reqFalsa({ query }), res);
        expect(servicio.mapa).toHaveBeenCalledWith('z', minutos);
        expect(res.cuerpo).toEqual({ success: true, data: { nombre: 'P' } });
    });
});

describe('ReportesController', () => {
    let servicio: Record<string, ReturnType<typeof vi.fn>>;
    let auditoria: { registrar: ReturnType<typeof vi.fn> };
    let ctrl: ReportesController;

    beforeEach(() => {
        servicio = {
            crear: vi.fn(() => Promise.resolve({ idReporte: 'r1' })),
            listar: vi.fn(() => Promise.resolve([])),
            obtener: vi.fn(() => Promise.resolve({ idReporte: 'r1' })),
            exportarCsv: vi.fn(() => Promise.resolve({ nombreArchivo: 'a.csv', contenido: 'x' })),
            eliminar: vi.fn(),
        };
        auditoria = { registrar: vi.fn() };
        ctrl = new ReportesController(servicio as never, auditoria as never);
    });

    it('crea a nombre del admin y responde 201', async () => {
        const res = resFalsa();
        await ctrl.crear(reqFalsa({ admin: ADMIN, body: { tipoReporte: 'alertas' } }), res);
        expect(servicio.crear).toHaveBeenCalledWith({ tipoReporte: 'alertas' }, 1);
        expect(res.statusCode).toBe(201);
        await expect(ctrl.crear(reqFalsa(), resFalsa())).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('lista, obtiene y exporta', async () => {
        const res = resFalsa();
        await ctrl.listar(reqFalsa(), res);
        await ctrl.obtener(reqFalsa({ params: { id: 'r1' } }), res);
        await ctrl.exportarCsv(reqFalsa({ params: { id: 'r1' } }), res);
        expect(servicio.obtener).toHaveBeenCalledWith('r1');
        expect(servicio.exportarCsv).toHaveBeenCalledWith('r1');
        expect(res.cuerpo).toEqual({ success: true, data: { nombreArchivo: 'a.csv', contenido: 'x' } });
    });

    it('elimina y audita', async () => {
        const res = resFalsa();
        await ctrl.eliminar(reqFalsa({ admin: ADMIN, params: { id: 'r1' } }), res);
        expect(servicio.eliminar).toHaveBeenCalledWith('r1');
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'reporte_eliminado', idAdmin: 1, detalle: 'reporte=r1', ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: 'Reporte eliminado' });
    });
});

describe('SensorController', () => {
    /** Controlador con un consumidor de Kafka y una auditoría falsos. */
    const crear = (running = false) => {
        const consumer = { start: vi.fn(), stop: vi.fn(), running };
        const auditoria = { registrar: vi.fn() };
        return { consumer, auditoria, ctrl: new SensorController(consumer as never, auditoria as never) };
    };

    it('inicia el consumidor y lo audita', async () => {
        const { consumer, auditoria, ctrl } = crear();
        const res = resFalsa();
        await ctrl.start(reqFalsa({ admin: ADMIN }), res);
        expect(consumer.start).toHaveBeenCalledOnce();
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'consumidor_iniciado', idAdmin: 1, ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: MESSAGES.CONSUMER.STARTED });
    });

    it('detiene el consumidor y lo audita', async () => {
        const { consumer, auditoria, ctrl } = crear();
        const res = resFalsa();
        await ctrl.stop(reqFalsa(), res);
        expect(consumer.stop).toHaveBeenCalledOnce();
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'consumidor_detenido', idAdmin: undefined, ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: MESSAGES.CONSUMER.STOPPED });
    });

    it.each([
        [true, 'active'],
        [false, 'stopped'],
    ])('estado con running=%s', (running, status) => {
        const { ctrl } = crear(running);
        const res = resFalsa();
        ctrl.status(reqFalsa(), res);
        expect(res.cuerpo).toEqual({ success: true, running, status });
    });
});
