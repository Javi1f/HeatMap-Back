import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatmapService } from '../../../src/modules/metrics/heatmap.service';
import { PublicoService } from '../../../src/modules/publico/publico.service';
import { NotFoundError, ValidationError } from '../../../src/common/errors';

/*
 * El servicio guarda cada mapa un segundo por zona y ventana; cada prueba usa
 * un identificador de zona nuevo para no leer el resultado de otra.
 */

const presente = { rssiMedio: -60, esMacRandom: false };

/** `HeatmapService` con repositorios, posicionador y presencia falsos. */
const crear = () => {
    const dobles = {
        capturas: { distanciasPorNodo: vi.fn(() => Promise.resolve([] as unknown[])) },
        sensores: { findAll: vi.fn(() => Promise.resolve([] as unknown[])) },
        zonas: { findById: vi.fn() },
        posicionador: { estimar: vi.fn() },
        presencia: { evaluar: vi.fn(() => Promise.resolve(new Map())) },
    };
    const servicio = new HeatmapService(dobles.capturas as never, dobles.sensores as never, dobles.zonas as never, dobles.posicionador as never, dobles.presencia as never);
    return { servicio, ...dobles };
};

/** Distancia media de un dispositivo a un nodo. */
const lectura = (macHash: string, idSensor: string, distancia = 3) => ({ macHash, idSensor, posX: 0, posY: 0, distancia });

let entorno: ReturnType<typeof crear>;
let idZona: string;
beforeEach(() => {
    entorno = crear();
    idZona = randomUUID();
    entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'Plazoleta', coordenadas: { ancho: 2, alto: 1.5 } });
});

describe('HeatmapService', () => {
    it('falla si la zona no existe', async () => {
        entorno.zonas.findById.mockResolvedValue(null);
        await expect(entorno.servicio.generar(idZona)).rejects.toBeInstanceOf(NotFoundError);
    });

    it.each([
        ['sin coordenadas', null],
        ['sin ancho', { alto: 3 }],
        ['con medidas no numéricas', { ancho: 'x', alto: 3 }],
        ['con medidas no positivas', { ancho: 0, alto: 3 }],
    ])('exige geometría: zona %s', async (_caso, coordenadas) => {
        entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'Z', coordenadas });
        await expect(entorno.servicio.generar(idZona)).rejects.toBeInstanceOf(ValidationError);
    });

    it('construye la rejilla de celdas de 0,5 m vacía si no hay nadie', async () => {
        const mapa = await entorno.servicio.generar(idZona);
        expect(mapa).toMatchObject({ idZona, nombre: 'Plazoleta', ancho: 2, alto: 1.5, ladoCelda: 0.5, columnas: 4, filas: 3, maximo: 0, situados: 0, sinPosicion: 0 });
        expect(mapa.rejilla).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
        expect(mapa.descartadosInfraestructura).toBe(0);
    });

    it('limita la ventana entre 1 y 120 minutos', async () => {
        const corto = await entorno.servicio.generar(idZona, 0);
        expect(Date.parse(corto.hasta) - Date.parse(corto.desde)).toBe(60_000);
        const recortado = await entorno.servicio.generar(randomUUID(), 999);
        expect(Date.parse(recortado.hasta) - Date.parse(recortado.desde)).toBe(120 * 60_000);
    });

    it('sitúa solo a los presentes, cuenta por celda y separa los que no se pudieron situar', async () => {
        entorno.capturas.distanciasPorNodo.mockResolvedValue([
            lectura('a', 'n1'), lectura('a', 'n2'),
            lectura('b', 'n1'), lectura('b', 'n2'),
            lectura('c', 'n1'),
            lectura('fuera', 'n3'),
        ]);
        entorno.presencia.evaluar.mockResolvedValue(new Map([[idZona, {
            presentes: new Map([['a', presente], ['b', presente], ['c', presente]]),
            descartadosInfraestructura: 2,
            descartadosFueraDeZona: 5,
        }]]));
        entorno.posicionador.estimar.mockImplementation((obs: unknown[]) => (obs.length >= 2 ? { x: 1.2, y: 0.7 } : null));

        const mapa = await entorno.servicio.generar(idZona);

        expect(entorno.posicionador.estimar).toHaveBeenCalledTimes(3);
        expect(mapa.rejilla[1][2]).toBe(2);
        expect(mapa).toMatchObject({ maximo: 2, situados: 2, sinPosicion: 1, descartadosInfraestructura: 2, descartadosFueraDeZona: 5 });
    });

    it('pega al borde las posiciones del margen exterior tolerado', async () => {
        entorno.capturas.distanciasPorNodo.mockResolvedValue([lectura('a', 'n1'), lectura('b', 'n1')]);
        entorno.presencia.evaluar.mockResolvedValue(new Map([[idZona, { presentes: new Map([['a', presente], ['b', presente]]), descartadosInfraestructura: 0, descartadosFueraDeZona: 0 }]]));
        entorno.posicionador.estimar.mockReturnValueOnce({ x: -0.3, y: -0.2 }).mockReturnValueOnce({ x: 9, y: 9 });

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa.rejilla[0][0]).toBe(1);
        expect(mapa.rejilla[2][3]).toBe(1);
    });

    it('aplica la corrección vertical declarada por la zona', async () => {
        entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'P', coordenadas: { ancho: 2, alto: 2, ajusteVerticalM: 1 } });
        entorno.capturas.distanciasPorNodo.mockResolvedValue([lectura('a', 'n1')]);
        entorno.presencia.evaluar.mockResolvedValue(new Map([[idZona, { presentes: new Map([['a', presente]]), descartadosInfraestructura: 0, descartadosFueraDeZona: 0 }]]));
        entorno.posicionador.estimar.mockReturnValue({ x: 0.2, y: 0.2 });

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa.rejilla[2][0]).toBe(1);
    });

    it('ignora una corrección vertical no numérica', async () => {
        entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'P', coordenadas: { ancho: 2, alto: 2, ajusteVerticalM: 'mucho' } });
        entorno.capturas.distanciasPorNodo.mockResolvedValue([lectura('a', 'n1')]);
        entorno.presencia.evaluar.mockResolvedValue(new Map([[idZona, { presentes: new Map([['a', presente]]), descartadosInfraestructura: 0, descartadosFueraDeZona: 0 }]]));
        entorno.posicionador.estimar.mockReturnValue({ x: 0.2, y: 0.2 });

        expect((await entorno.servicio.generar(idZona)).rejilla[0][0]).toBe(1);
    });

    it('dibuja solo los nodos de la zona con posición e indica cuáles aportaron datos', async () => {
        entorno.capturas.distanciasPorNodo.mockResolvedValue([lectura('x', 'n1')]);
        entorno.sensores.findAll.mockResolvedValue([
            { idSensor: 'n1', nombre: 'Nodo 1', idZona, posX: 0, posY: 0 },
            { idSensor: 'n2', nombre: 'Nodo 2', idZona, posX: 2, posY: 0 },
            { idSensor: 'n3', nombre: 'Sin posición', idZona, posX: null, posY: null },
            { idSensor: 'n4', nombre: 'Otra zona', idZona: 'otra', posX: 1, posY: 1 },
        ]);

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa.nodos).toEqual([
            { idSensor: 'n1', nombre: 'Nodo 1', x: 0, y: 0, aportoDatos: true },
            { idSensor: 'n2', nombre: 'Nodo 2', x: 2, y: 0, aportoDatos: false },
        ]);
    });

    it('reutiliza el mapa recién calculado para la misma zona y ventana', async () => {
        await Promise.all([entorno.servicio.generar(idZona, 5), entorno.servicio.generar(idZona, 5)]);
        expect(entorno.zonas.findById).toHaveBeenCalledTimes(1);
        await entorno.servicio.generar(idZona, 10);
        expect(entorno.zonas.findById).toHaveBeenCalledTimes(2);
    });
});

describe('PublicoService', () => {
    it('ofrece solo zonas con geometría y su nivel, o «sin datos»', async () => {
        const zonas = {
            findActive: vi.fn(() => Promise.resolve([
                { idZona: 'a', nombre: 'A', descripcion: 'desc', coordenadas: { ancho: 5, alto: 5 } },
                { idZona: 'b', nombre: 'B', descripcion: null, coordenadas: { ancho: 5, alto: 5 } },
                { idZona: 'c', nombre: 'C', descripcion: null, coordenadas: null },
                { idZona: 'd', nombre: 'D', descripcion: null, coordenadas: { ancho: -1, alto: 5 } },
            ])),
        };
        const ocupacion = { findLatestPerZone: vi.fn(() => Promise.resolve([{ idZona: 'a', nivelOcupacion: 'alta' }])) };
        const servicio = new PublicoService({} as never, zonas as never, ocupacion as never);

        await expect(servicio.listarZonas()).resolves.toEqual([
            { idZona: 'a', nombre: 'A', descripcion: 'desc', nivelOcupacion: 'alta' },
            { idZona: 'b', nombre: 'B', descripcion: null, nivelOcupacion: 'sin datos' },
        ]);
    });

    it('el mapa público no expone identificadores de zona, nodo ni descartes', async () => {
        const interno = {
            idZona: 'secreta', nombre: 'Plazoleta', ancho: 11.84, alto: 21, ladoCelda: 0.5, columnas: 24, filas: 42,
            rejilla: [[1]], maximo: 1, situados: 1, sinPosicion: 2, descartadosInfraestructura: 7, descartadosFueraDeZona: 9,
            nodos: [{ idSensor: 'nodo-interno', nombre: 'Nodo 1', x: 0, y: 0, aportoDatos: true }],
            desde: '2026-09-14T10:00:00.000Z', hasta: '2026-09-14T10:05:00.000Z',
        };
        const heatmap = { generar: vi.fn(() => Promise.resolve(interno)) };
        const servicio = new PublicoService(heatmap as never, {} as never, {} as never);

        const mapa = await servicio.mapa('secreta', 5);

        expect(heatmap.generar).toHaveBeenCalledWith('secreta', 5);
        expect(mapa).toEqual({
            nombre: 'Plazoleta', ancho: 11.84, alto: 21, ladoCelda: 0.5, columnas: 24, filas: 42, rejilla: [[1]],
            maximo: 1, situados: 1, sinPosicion: 2, nodos: [{ nombre: 'Nodo 1', x: 0, y: 0, aportoDatos: true }],
            ventanaMinutos: 5, hasta: '2026-09-14T10:05:00.000Z',
        });
        expect(JSON.stringify(mapa)).not.toMatch(/secreta|nodo-interno|descartados/);
    });
});
