import { describe, expect, it } from 'vitest';
import { validarLectura } from '../../../src/modules/ingesta/validacion-lectura';
import { filtrarMacs, totalDescartes } from '../../../src/modules/ingesta/filtro-mac';
import { esMacAleatoria, esMacBienFormada, esMacDeGrupo, normalizarMac } from '../../../src/common/utils/mac';

/* Todas las MAC de este archivo son sintéticas. */

const AHORA = 1_789_000_000;

/** Lectura con el formato del productor. */
const bruta = (devices: unknown[], extra: Record<string, unknown> = {}) => ({
    sensor_id: 'nodo-1', timestamp: AHORA, total_devices: devices.length, devices, ...extra,
});

describe('primitivas de MAC', () => {
    it('normaliza separadores y mayúsculas a doce dígitos hexadecimales', () => {
        expect(normalizarMac('AA:BB-cc.dd:EE:ff')).toBe('aabbccddeeff');
        expect(esMacBienFormada('aabbccddeeff')).toBe(true);
        expect(esMacBienFormada('aabbcc')).toBe(false);
    });

    it('reconoce direcciones de grupo por el bit I/G', () => {
        expect(esMacDeGrupo('ffffffffffff')).toBe(true);
        expect(esMacDeGrupo('01005e000001')).toBe(true);
        expect(esMacDeGrupo('100000000001')).toBe(false);
    });

    it('reconoce las aleatorizadas por el bit U/L y rechaza lo que no es una MAC', () => {
        expect(esMacAleatoria('02:00:00:00:00:01')).toBe(true);
        expect(esMacAleatoria('10:00:00:00:00:01')).toBe(false);
        expect(esMacAleatoria('02:00')).toBe(false);
    });
});

describe('validarLectura', () => {
    it('acepta una lectura del productor y se queda solo con lo que el sistema usa', () => {
        const resultado = validarLectura(bruta([
            { mac: '10:00:00:00:00:01', rssi: -61.7, channel: 11, status: 'ASSOCIATED', ssid: 'casa', packets: 9 },
            { mac: '10:00:00:00:00:02', rssi: -70, channel: '6' },
            { mac: '10:00:00:00:00:03', rssi: -75, channel: 400, type: 'Probe' },
            { mac: '10:00:00:00:00:04', rssi: -80, status: 'un-estado-demasiado-largo-para-la-columna' },
        ]));

        expect(resultado).toEqual({
            valida: true,
            descartados: 0,
            lectura: {
                sensorId: 'nodo-1',
                timestamp: AHORA,
                dispositivos: [
                    { mac: '10:00:00:00:00:01', rssi: -61, canal: 11, tipoTrama: 'associated' },
                    { mac: '10:00:00:00:00:02', rssi: -70, canal: 6, tipoTrama: 'desconocido' },
                    { mac: '10:00:00:00:00:03', rssi: -75, canal: 0, tipoTrama: 'probe' },
                    { mac: '10:00:00:00:00:04', rssi: -80, canal: 0, tipoTrama: 'un-estado-demasiado-' },
                ],
            },
        });
    });

    it('descarta solo los dispositivos inválidos y cuenta cuántos', () => {
        const resultado = validarLectura(bruta([
            { mac: '10:00:00:00:00:01', rssi: -60 },
            { mac: '10:00:00:00:00:02', rssi: 12 },
            { mac: '', rssi: -60 },
            { rssi: -60 },
            'no-es-un-objeto',
        ]));
        expect(resultado.valida && resultado.descartados).toBe(4);
        expect(resultado.valida && resultado.lectura.dispositivos).toHaveLength(1);
    });

    it.each([
        ['sin nodo', bruta([], { sensor_id: undefined }), 'sensor_id'],
        ['con nodo vacío', bruta([], { sensor_id: '  ' }), 'sensor_id'],
        ['sin marca de tiempo', bruta([], { timestamp: 'ayer' }), 'timestamp'],
        ['sin lista de dispositivos', bruta([], { devices: {} }), 'devices'],
        ['con demasiados dispositivos', bruta(new Array(5001).fill({})), 'devices'],
        ['que no es un objeto', 'texto', 'lectura'],
    ])('rechaza una lectura %s', (_caso, dato, campo) => {
        const resultado = validarLectura(dato);
        expect(resultado.valida).toBe(false);
        expect(!resultado.valida && resultado.motivo).toMatch(new RegExp(`^${campo}`));
    });
});

describe('filtrarMacs', () => {
    /** Dispositivo validado. */
    const dispositivo = (mac: string, rssi = -60) => ({ mac, rssi, canal: 1, tipoTrama: 'probing' });

    it('deja una sola entrada por MAC, la de señal más fuerte, en forma canónica', () => {
        const { dispositivos, descartes } = filtrarMacs([
            dispositivo('10:00:00:00:00:01', -70),
            dispositivo('10-00-00-00-00-01', -55),
            dispositivo('10:00:00:00:00:01', -80),
            dispositivo('10:00:00:00:00:02', -65),
        ]);
        expect(dispositivos).toEqual([
            { mac: '100000000001', rssi: -55, canal: 1, tipoTrama: 'probing' },
            { mac: '100000000002', rssi: -65, canal: 1, tipoTrama: 'probing' },
        ]);
        expect(descartes).toEqual({ malformadas: 0, deGrupo: 0, duplicadas: 2 });
    });

    it('quita las mal formadas y las de grupo, pero conserva las aleatorizadas', () => {
        const { dispositivos, descartes } = filtrarMacs([
            dispositivo('10:00:00'),
            dispositivo('ff:ff:ff:ff:ff:ff'),
            dispositivo('01:00:5e:00:00:01'),
            dispositivo('02:00:00:00:00:01'),
        ]);
        expect(dispositivos.map((d) => d.mac)).toEqual(['020000000001']);
        expect(descartes).toEqual({ malformadas: 1, deGrupo: 2, duplicadas: 0 });
        expect(totalDescartes(descartes)).toBe(3);
    });
});
