import { describe, expect, it } from 'vitest';
import {
    CriteriosPresencia,
    detectarInfraestructura,
    evaluarPresencia,
    resumirPresentes,
    SenalPorNodo,
} from '../../../src/modules/sensor/services/presencia';

/**
 * Los casos salen de una medición real en la plazoleta. Los BSSID son los que
 * emiten los dos puntos de acceso de la universidad, identificadores públicos
 * que cualquier equipo cercano recibe. Las MAC de clientes son inventadas.
 */
describe('detectarInfraestructura', () => {
    it('reconoce los BSSID de un mismo punto de acceso', () => {
        const aparato = [
            { mac: 'a4:b2:39:9b:84:60', rssi: -54 },
            { mac: 'a4:b2:39:9b:84:63', rssi: -57 },
            { mac: 'a4:b2:39:9b:84:6c', rssi: -54 },
            { mac: 'a4:b2:39:9b:84:6e', rssi: -54 },
            { mac: 'a4:b2:39:9b:84:6f', rssi: -54 },
        ];
        const motivos = detectarInfraestructura(aparato);
        expect([...motivos.values()]).toEqual(Array(5).fill('punto-de-acceso'));
    });

    it('separa dos puntos de acceso del mismo fabricante', () => {
        const motivos = detectarInfraestructura([
            { mac: 'a4:b2:39:9b:84:6c', rssi: -54 },
            { mac: 'a4:b2:39:9b:84:6e', rssi: -54 },
            { mac: 'a4:b2:39:9b:92:e0', rssi: -47 },
            { mac: 'a4:b2:39:9b:92:e1', rssi: -46 },
        ]);
        expect(motivos.size).toBe(4);
    });

    it('no confunde con un punto de acceso a un dispositivo suelto', () => {
        const motivos = detectarInfraestructura([
            { mac: '3c:22:fb:10:aa:01', rssi: -62 },
            { mac: '9e:e2:ff:00:00:01', rssi: -70 },
            { mac: 'a4:b2:39:9b:84:6c', rssi: -54 },
        ]);
        expect(motivos.size).toBe(0);
    });

    it('exige además que los hermanos se oigan con la misma señal', () => {
        const motivos = detectarInfraestructura([
            { mac: 'a4:b2:39:9b:84:6c', rssi: -48 },
            { mac: 'a4:b2:39:9b:84:6e', rssi: -85 },
        ]);
        expect(motivos.size).toBe(0);
    });

    it('marca lo que está pegado al nodo', () => {
        const motivos = detectarInfraestructura([
            { mac: 'dc:a6:32:00:00:01', rssi: -21 },
            { mac: '9e:e2:ff:00:00:02', rssi: -33 },
            { mac: '3c:22:fb:10:aa:01', rssi: -62 },
        ]);
        expect(motivos.get('dc:a6:32:00:00:01')).toBe('junto-a-nodo');
        expect(motivos.get('9e:e2:ff:00:00:02')).toBe('junto-a-nodo');
        expect(motivos.has('3c:22:fb:10:aa:01')).toBe(false);
    });

    it('ignora direcciones mal formadas', () => {
        expect(detectarInfraestructura([{ mac: 'no-es-una-mac', rssi: -20 }]).size).toBe(0);
        expect(
            detectarInfraestructura([
                { mac: 'a4:b2:39', rssi: -50 },
                { mac: 'a4:b2:39', rssi: -50 },
            ]).size,
        ).toBe(0);
    });
});

/** Construye las señales de un dispositivo en cada nodo. */
const senales = (macHash: string, rssiPorNodo: Record<string, number>, esMacRandom = false): SenalPorNodo[] =>
    Object.entries(rssiPorNodo).map(([idSensor, rssi]) => ({ macHash, idSensor, rssi, esMacRandom }));

const CRITERIOS: CriteriosPresencia = { rssiMinimoDbm: -80, excluidos: new Set() };

describe('evaluarPresencia', () => {
    it('cuenta a quien oyen bien todos los nodos', () => {
        const { presentes } = evaluarPresencia(
            senales('portatil', { n1: -62, n2: -62, n3: -62 }),
            CRITERIOS,
        );
        expect(presentes.get('portatil')).toEqual({ rssiMedio: -62, esMacRandom: false });
    });

    it('descarta lo que sólo oye fuerte el nodo de una esquina', () => {
        const resultado = evaluarPresencia(
            [
                ...senales('tras-la-pared', { n1: -58 }),
                ...senales('referencia', { n1: -60, n2: -61, n3: -63 }),
            ],
            CRITERIOS,
        );
        expect(resultado.presentes.has('tras-la-pared')).toBe(false);
        expect(resultado.descartadosFueraDeZona).toBe(1);
    });

    it('descarta lo que todos oyen atenuado, como el piso de abajo', () => {
        const resultado = evaluarPresencia(senales('piso-inferior', { n1: -84, n2: -82, n3: -86 }), CRITERIOS);
        expect(resultado.presentes.size).toBe(0);
        expect(resultado.descartadosFueraDeZona).toBe(1);
    });

    it('decide por el nodo que peor lo oye, no por el mejor', () => {
        const resultado = evaluarPresencia(senales('esquina', { n1: -50, n2: -52, n3: -83 }), CRITERIOS);
        expect(resultado.presentes.size).toBe(0);
    });

    it('acepta la señal justo en el umbral', () => {
        const resultado = evaluarPresencia(senales('limite', { n1: -80, n2: -70, n3: -75 }), CRITERIOS);
        expect(resultado.presentes.has('limite')).toBe(true);
    });

    it('excluye la infraestructura aunque su señal sea perfecta', () => {
        const resultado = evaluarPresencia(senales('router', { n1: -52, n2: -54, n3: -42 }), {
            ...CRITERIOS,
            excluidos: new Set(['router']),
        });
        expect(resultado.presentes.size).toBe(0);
        expect(resultado.descartadosInfraestructura).toBe(1);
    });

    it('con un nodo caído, exige sólo a los que siguen emitiendo', () => {
        const resultado = evaluarPresencia(
            [...senales('a', { n1: -60, n2: -65 }), ...senales('b', { n1: -70, n2: -72 })],
            CRITERIOS,
        );
        expect(resultado.presentes.size).toBe(2);
    });

    it('conserva si la MAC es aleatoria', () => {
        const { presentes } = evaluarPresencia(senales('telefono', { n1: -70, n2: -71 }, true), CRITERIOS);
        expect(presentes.get('telefono')?.esMacRandom).toBe(true);
    });

    it('sin señales, no hay nadie', () => {
        const resultado = evaluarPresencia([], CRITERIOS);
        expect(resultado).toEqual({ presentes: new Map(), descartadosInfraestructura: 0, descartadosFueraDeZona: 0 });
    });
});

describe('resumirPresentes', () => {
    it('suma varias zonas y separa MAC fijas de aleatorias', () => {
        const zonaA = new Map([
            ['a', { rssiMedio: -60, esMacRandom: false }],
            ['b', { rssiMedio: -70, esMacRandom: true }],
        ]);
        const zonaB = new Map([['c', { rssiMedio: -80, esMacRandom: true }]]);

        expect(resumirPresentes(zonaA, zonaB)).toEqual({
            dispositivos: 3,
            estables: 1,
            aleatorias: 2,
            rssiMedio: -70,
        });
    });

    it('sin presentes no inventa una señal media', () => {
        expect(resumirPresentes(new Map())).toEqual({ dispositivos: 0, estables: 0, aleatorias: 0, rssiMedio: null });
    });
});
