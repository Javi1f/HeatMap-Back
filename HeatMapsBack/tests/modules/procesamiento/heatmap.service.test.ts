import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeatmapService } from '../../../src/modules/procesamiento/heatmap.service';
import { PublicoService } from '../../../src/modules/historicos/publico/publico.service';
import { NotFoundError, ValidationError } from '../../../src/common/errors';
import { loggerFalso } from '../../helpers/dobles';

/*
 * El servicio guarda cada mapa un segundo por zona y ventana; cada prueba usa
 * un identificador de zona nuevo para no leer el resultado de otra.
 */

const presente = { rssiMedio: -60, esMacRandom: false };

/** Nodos de la zona de pruebas, de 10 × 6 m: dos esquinas inferiores y el centro del borde superior. */
const NODOS: Record<string, { posX: number; posY: number }> = {
    n1: { posX: 0, posY: 0 },
    n2: { posX: 10, posY: 0 },
    n3: { posX: 5, posY: 6 },
};

/**
 * Modelo de propagación de pruebas: referencia −40 dBm y exponente 3, con la
 * misma forma que el real. Por debajo de −100 dBm no da distancia.
 */
const distanciaDe = (rssi: number): number | null => (rssi <= -100 ? null : 10 ** ((-40 - rssi) / 30));

/** `HeatmapService` con repositorios, posicionador, presencia y modelo falsos. */
const crear = () => {
    const dobles = {
        capturas: { senalesDeNodosSituados: vi.fn(() => Promise.resolve([] as unknown[])) },
        sensores: { findAll: vi.fn(() => Promise.resolve([] as unknown[])) },
        zonas: { findById: vi.fn() },
        posicionador: { estimar: vi.fn(() => ({ x: 5, y: 3, factorEscala: 1.8, dispersion: 1 })) },
        presencia: { evaluar: vi.fn(() => Promise.resolve(new Map())) },
        distancias: {
            estimate: vi.fn(distanciaDe),
            desajusteDb: vi.fn(() => 6.4),
            aLogDistancia: vi.fn(() => 0.46),
        },
        logger: loggerFalso(),
    };
    const servicio = new HeatmapService(
        dobles.capturas as never, dobles.sensores as never, dobles.zonas as never,
        dobles.posicionador as never, dobles.presencia as never, dobles.distancias as never,
        dobles.logger as never,
    );
    return { servicio, ...dobles };
};

/** Señal media de un dispositivo en uno de los nodos de la zona de pruebas. */
const senal = (macHash: string, idSensor: string, rssi = -60) => ({ macHash, idSensor, ...NODOS[idSensor], rssi });

/** Evaluación de presencia con los dispositivos indicados como presentes. */
const presentes = (idZona: string, ...hashes: string[]) =>
    new Map([[idZona, { presentes: new Map(hashes.map((hash) => [hash, presente])), descartadosInfraestructura: 0, descartadosFueraDeZona: 0 }]]);

/** Celdas ocupadas, como `[fila, columna, conteo]`. */
const ocupadas = (rejilla: number[][]): [number, number, number][] =>
    rejilla.flatMap((fila, fil) => fila.flatMap((valor, col) => (valor > 0 ? [[fil, col, valor] as [number, number, number]] : [])));

let entorno: ReturnType<typeof crear>;
let idZona: string;
beforeEach(() => {
    entorno = crear();
    idZona = randomUUID();
    entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'Plazoleta', coordenadas: { ancho: 10, alto: 6 } });
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
        entorno.zonas.findById.mockResolvedValue({ idZona, nombre: 'Plazoleta', coordenadas: { ancho: 2, alto: 1.5 } });
        const mapa = await entorno.servicio.generar(idZona);
        expect(mapa).toMatchObject({ idZona, nombre: 'Plazoleta', ancho: 2, alto: 1.5, ladoCelda: 0.5, columnas: 4, filas: 3, maximo: 0, situados: 0, sinPosicion: 0 });
        expect(mapa.rejilla).toEqual([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
        expect(mapa).toMatchObject({ descartadosInfraestructura: 0, desajusteReferenciaDb: null });
    });

    it('sitúa a cada dispositivo con su último minuto de lecturas, no con toda la ventana', async () => {
        await entorno.servicio.generar(idZona, 30);
        const [, desde, hasta, episodio] = entorno.capturas.senalesDeNodosSituados.mock.calls[0] as unknown as [string, Date, Date, number];
        expect(hasta.getTime() - desde.getTime()).toBe(30 * 60_000);
        expect(episodio).toBe(60);
    });

    it('limita la ventana entre 1 y 120 minutos', async () => {
        const corto = await entorno.servicio.generar(idZona, 0);
        expect(Date.parse(corto.hasta) - Date.parse(corto.desde)).toBe(60_000);
        const recortado = await entorno.servicio.generar(randomUUID(), 999);
        expect(Date.parse(recortado.hasta) - Date.parse(recortado.desde)).toBe(120 * 60_000);
    });

    it('cuenta a cada presente en la celda de su posición estimada', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([
            senal('a', 'n1', -55), senal('a', 'n2', -70),
            senal('b', 'n1', -60), senal('b', 'n2', -60), senal('b', 'n3', -58),
            senal('fuera', 'n2', -52), senal('fuera', 'n3', -52),
        ]);
        entorno.presencia.evaluar.mockResolvedValue(new Map([[idZona, {
            presentes: new Map([['a', presente], ['b', presente]]),
            descartadosInfraestructura: 2,
            descartadosFueraDeZona: 5,
        }]]));
        entorno.posicionador.estimar
            .mockReturnValueOnce({ x: 2.2, y: 1.1, factorEscala: 1, dispersion: 1 })
            .mockReturnValueOnce({ x: 2.4, y: 1.4, factorEscala: 1, dispersion: 1 });

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa).toMatchObject({ situados: 2, sinPosicion: 0, descartadosInfraestructura: 2, descartadosFueraDeZona: 5, maximo: 2 });
        // Los dos caen en la celda (2,0-2,5; 1,0-1,5): fila 2, columna 4.
        expect(ocupadas(mapa.rejilla)).toEqual([[2, 4, 2]]);
        expect(entorno.posicionador.estimar).toHaveBeenCalledTimes(2);
        // La duda de cada enlace se traduce con el exponente en uso, no con uno fijo.
        expect(entorno.distancias.aLogDistancia).toHaveBeenCalledWith(4);
        expect(entorno.posicionador.estimar).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), 0.46);
    });

    it.each([
        ['n1', [0, 0]],
        ['n2', [0, 19]],
        ['n3', [11, 10]],
    ])('quien sólo oye un nodo, %s, aparece junto a ese nodo', async (nodo, celda) => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('solo', nodo, -45)]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'solo'));

        const { rejilla, situados } = await entorno.servicio.generar(idZona);

        expect(situados).toBe(1);
        // En el borde del espacio la celda se pega dentro de la rejilla.
        expect(ocupadas(rejilla)).toEqual([[...celda, 1]]);
        expect(entorno.posicionador.estimar).not.toHaveBeenCalled();
    });

    it('pega al borde una posición del margen exterior tolerado', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('a', 'n1'), senal('a', 'n2')]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a'));
        entorno.posicionador.estimar.mockReturnValueOnce({ x: -0.4, y: 6.3, factorEscala: 1, dispersion: 1 });

        expect(ocupadas((await entorno.servicio.generar(idZona)).rejilla)).toEqual([[11, 0, 1]]);
    });

    it('sin ninguna distancia utilizable, el dispositivo queda sin posición', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('a', 'n1', -120), senal('b', 'n2', -60)]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a', 'b'));

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa).toMatchObject({ situados: 1, sinPosicion: 1, maximo: 1 });
    });

    it('publica el desajuste del modelo a partir de la mediana de las escalas medidas', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue(
            ['a', 'b', 'c'].flatMap((hash) => [senal(hash, 'n1'), senal(hash, 'n2')]),
        );
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a', 'b', 'c'));
        entorno.posicionador.estimar
            .mockReturnValueOnce({ x: 5, y: 3, factorEscala: 1.2, dispersion: 1 })
            .mockReturnValueOnce({ x: 5, y: 3, factorEscala: 2, dispersion: 1 })
            .mockReturnValueOnce({ x: 5, y: 3, factorEscala: 5, dispersion: 1 });

        const mapa = await entorno.servicio.generar(idZona);

        expect(entorno.distancias.desajusteDb).toHaveBeenCalledWith(2);
        expect(mapa.desajusteReferenciaDb).toBe(6.4);
        expect(entorno.logger.warn).toHaveBeenCalledWith(expect.stringContaining('6.4 dB'));
    });

    it('si el posicionador no resuelve, el dispositivo queda sin posición y no cuenta para el desajuste', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('a', 'n1'), senal('a', 'n2')]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a'));
        entorno.posicionador.estimar.mockReturnValueOnce(null as never);

        const mapa = await entorno.servicio.generar(idZona);

        expect(mapa).toMatchObject({ situados: 0, sinPosicion: 1, maximo: 0 });
        expect(mapa.desajusteReferenciaDb).toBeNull();
    });

    it('no avisa del desajuste mientras entre en el ruido de la señal', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('a', 'n1'), senal('a', 'n2')]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a'));
        entorno.distancias.desajusteDb.mockReturnValue(0.6);

        expect((await entorno.servicio.generar(idZona)).desajusteReferenciaDb).toBe(0.6);
        expect(entorno.logger.warn).not.toHaveBeenCalled();
    });

    it('no repite el aviso de una zona en cada recarga del mapa', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('a', 'n1'), senal('a', 'n2')]);
        entorno.presencia.evaluar.mockResolvedValue(presentes(idZona, 'a'));

        await entorno.servicio.generar(idZona, 5);
        await entorno.servicio.generar(idZona, 7);

        expect(entorno.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('dibuja solo los nodos de la zona con posición e indica cuáles aportaron datos', async () => {
        entorno.capturas.senalesDeNodosSituados.mockResolvedValue([senal('x', 'n1')]);
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

    it('el mapa público no expone identificadores de zona, nodo ni diagnósticos', async () => {
        const interno = {
            idZona: 'secreta', nombre: 'Plazoleta', ancho: 11.84, alto: 21, ladoCelda: 0.5, columnas: 24, filas: 42,
            rejilla: [[1]], maximo: 1, situados: 1, sinPosicion: 2, descartadosInfraestructura: 7, descartadosFueraDeZona: 9,
            desajusteReferenciaDb: 6.4,
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
        expect(JSON.stringify(mapa)).not.toMatch(/secreta|nodo-interno|descartados|desajuste/);
    });
});
