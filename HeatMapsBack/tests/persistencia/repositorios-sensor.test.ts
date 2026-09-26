import { beforeEach, describe, expect, it } from 'vitest';
import { AlertaRepository } from '../../src/persistencia/repositorios/alerta.repository';
import { CapturaRepository } from '../../src/persistencia/repositorios/captura.repository';
import { InfraestructuraRepository } from '../../src/persistencia/repositorios/infraestructura.repository';
import { OcupacionRepository } from '../../src/persistencia/repositorios/ocupacion.repository';
import { SensorRepository } from '../../src/persistencia/repositorios/sensor.repository';
import { ZONA_SIN_ASIGNAR, ZonaRepository } from '../../src/persistencia/repositorios/zona.repository';
import { consultaFalsa, dbFalsa, repoTypeorm } from '../helpers/dobles';

const INICIO = new Date('2026-09-14T10:00:00Z');
const FIN = new Date('2026-09-14T11:00:00Z');

let repo: ReturnType<typeof repoTypeorm>;
beforeEach(() => { repo = repoTypeorm(); });

describe('AlertaRepository', () => {
    it('abiertas, conteo y si una zona ya tiene una abierta', async () => {
        const repositorio = new AlertaRepository(dbFalsa(repo));
        await repositorio.findUnresolved();
        expect(repo.find).toHaveBeenCalledWith({ where: { resuelta: false }, relations: { zona: true }, order: { timestampAlerta: 'DESC' } });

        repo.count.mockResolvedValueOnce(4);
        await expect(repositorio.countUnresolved()).resolves.toBe(4);

        repo.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        await expect(repositorio.hasOpenForZone('z')).resolves.toBe(true);
        await expect(repositorio.hasOpenForZone('z')).resolves.toBe(false);
        expect(repo.count).toHaveBeenLastCalledWith({ where: { idZona: 'z', resuelta: false } });
    });

    it.each([
        ['con zona', 'z1', 1],
        ['sin zona', null, 0],
    ])('por rango %s', async (_caso, idZona, filtrosZona) => {
        const consulta = consultaFalsa({ getMany: [{ idAlerta: 'a' }] });
        repo.createQueryBuilder.mockReturnValue(consulta);

        await expect(new AlertaRepository(dbFalsa(repo)).findByRange(INICIO, FIN, idZona)).resolves.toEqual([{ idAlerta: 'a' }]);

        expect(consulta.where).toHaveBeenCalledWith('a.timestampAlerta >= :inicio AND a.timestampAlerta <= :fin', { inicio: INICIO, fin: FIN });
        expect(consulta.andWhere).toHaveBeenCalledTimes(filtrosZona);
    });

    it('crea abierta y resuelve solo si seguía abierta', async () => {
        const repositorio = new AlertaRepository(dbFalsa(repo));
        await repositorio.create('z', 'alta', 'Aforo superado');
        expect(repo.save).toHaveBeenCalledWith({ idZona: 'z', nivel: 'alta', mensaje: 'Aforo superado', resuelta: false });

        await expect(repositorio.resolve('a', 'raiz')).resolves.toBe(true);
        expect(repo.update).toHaveBeenCalledWith({ idAlerta: 'a', resuelta: false }, { resuelta: true, resueltaPor: 'raiz' });
        repo.update.mockResolvedValueOnce({} as never);
        await expect(repositorio.resolve('a', 'raiz')).resolves.toBe(false);
    });
});

describe('CapturaRepository', () => {
    it('inserta en lote sin releer lo insertado, y no toca la base con un lote vacío', async () => {
        const consulta = consultaFalsa();
        repo.createQueryBuilder.mockReturnValue(consulta);
        const repositorio = new CapturaRepository(dbFalsa(repo));
        await expect(repositorio.insertMany([])).resolves.toBe(0);
        expect(repo.createQueryBuilder).not.toHaveBeenCalled();

        const fila = { macHash: 'h', idSensor: 'n1', rssi: -60, distanciaEstimada: 2, canal: 6, tipoTrama: 'probe', esMacRandom: false, timestampCaptura: INICIO };
        await expect(repositorio.insertMany([fila, fila])).resolves.toBe(2);
        expect(consulta.values).toHaveBeenCalledWith([fila, fila]);
        // Sin esto TypeORM lanza un SELECT de todas las filas recién escritas.
        expect(consulta.updateEntity).toHaveBeenCalledWith(false);
        expect(consulta.execute).toHaveBeenCalledOnce();
    });

    it('sitúa con las últimas lecturas de cada dispositivo, con el percentil 75 de la señal y no la distancia', async () => {
        repo.query.mockResolvedValueOnce([{ macHash: 'h', idSensor: 'n1', posX: '0.00', posY: '21.00', rssi: '-63.5000' }]);

        await expect(new CapturaRepository(dbFalsa(repo)).senalesDeNodosSituados('z', INICIO, FIN, 60)).resolves.toEqual([
            { macHash: 'h', idSensor: 'n1', posX: 0, posY: 21, rssi: -63.5 },
        ]);

        const [sql, valores] = repo.query.mock.calls[0] as unknown as [string, unknown[]];
        // Sólo las lecturas del último minuto de cada dispositivo, no toda la ventana.
        expect(sql).toContain('MAX(c.timestamp_captura) OVER (PARTITION BY c.mac_hash) AS ultima');
        expect(sql).toContain('t.timestamp_captura >= t.ultima - INTERVAL ? SECOND');
        // Percentil 75 por pareja dispositivo-nodo: resiste a quien pasa por delante.
        expect(sql).toContain('ROW_NUMBER() OVER (PARTITION BY t.mac_hash, t.id_sensor ORDER BY t.rssi) AS orden');
        expect(sql).toContain('p.orden = FLOOR(0.75 * (p.tramas - 1)) + 1');
        expect(sql).not.toContain('AVG(');
        expect(sql).toContain('s.pos_x IS NOT NULL AND s.pos_y IS NOT NULL');
        expect(valores).toEqual(['z', INICIO, FIN, 60]);
    });

    it.each([
        ['de una zona', 'z', ['2026-09-14T10:00:00.000Z', '2026-09-14T11:00:00.000Z', 'z']],
        ['de todas', undefined, ['2026-09-14T10:00:00.000Z', '2026-09-14T11:00:00.000Z']],
    ])('señales por nodo %s', async (_caso, idZona, esperados) => {
        repo.query.mockResolvedValueOnce([
            { idZona: 'z', macHash: 'a', idSensor: 'n1', rssi: '-61.5', esMacRandom: '1' },
            { idZona: 'z', macHash: 'b', idSensor: 'n1', rssi: '-70', esMacRandom: 0 },
        ]);

        const senales = await new CapturaRepository(dbFalsa(repo)).senalesPorNodo(INICIO, FIN, idZona);

        expect(senales).toEqual([
            { idZona: 'z', macHash: 'a', idSensor: 'n1', rssi: -61.5, esMacRandom: true },
            { idZona: 'z', macHash: 'b', idSensor: 'n1', rssi: -70, esMacRandom: false },
        ]);
        const [sql, valores] = repo.query.mock.calls[0] as unknown as [string, unknown[]];
        expect((valores as unknown[]).map((valor) => (valor instanceof Date ? valor.toISOString() : valor))).toEqual(esperados);
        expect(sql.includes('AND s.id_zona = ?')).toBe(idZona !== undefined);
    });

    it('recorre primero las capturas por fecha, no el historial de cada nodo', async () => {
        const repositorio = new CapturaRepository(dbFalsa(repo));
        await repositorio.senalesPorNodo(INICIO, FIN);
        await repositorio.senalesDeNodosSituados('z', INICIO, FIN, 60);
        for (const [sql] of repo.query.mock.calls as unknown as [string][]) {
            expect(sql).toContain('FROM captura c STRAIGHT_JOIN sensor s');
        }
    });

    it('cuenta todas las tramas desde un momento', async () => {
        const consulta = consultaFalsa({ getCount: 321 });
        repo.createQueryBuilder.mockReturnValue(consulta);
        await expect(new CapturaRepository(dbFalsa(repo)).deteccionesDesde(INICIO)).resolves.toBe(321);
        expect(consulta.where).toHaveBeenCalledWith('c.timestampCaptura >= :since', { since: INICIO });
    });
});

describe('InfraestructuraRepository', () => {
    /** Repositorio de infraestructura sobre una conexión falsa que registra las consultas SQL. */
    const crear = () => {
        const db = dbFalsa(repo) as unknown as { dataSource: { query: typeof repo.query } };
        db.dataSource.query = repo.query;
        return new InfraestructuraRepository(db as never);
    };

    it('no escribe nada sin filas', async () => {
        await crear().registrar([], INICIO);
        expect(repo.query).not.toHaveBeenCalled();
    });

    it('registra con una sola sentencia que nunca rebaja una exclusión manual', async () => {
        await crear().registrar([{ macHash: 'a', motivo: 'punto-de-acceso' }, { macHash: 'b', motivo: 'junto-a-nodo' }], INICIO);

        const [sql, valores] = repo.query.mock.calls[0] as unknown as [string, unknown[]];
        expect(sql).toContain('VALUES (?, ?, ?, ?), (?, ?, ?, ?) AS nuevo');
        expect(sql).toContain("IF(dispositivo_infraestructura.motivo = 'manual', 'manual', nuevo.motivo)");
        // Por defecto, 20 minutos sin reconfirmar cortan la racha.
        expect(valores).toEqual(['a', 'punto-de-acceso', INICIO, INICIO, 'b', 'junto-a-nodo', INICIO, INICIO, 1200]);
    });

    it('reinicia la racha tras una pausa, comparando con la última confirmación anterior', async () => {
        await crear().registrar([{ macHash: 'a', motivo: 'junto-a-nodo' }], INICIO, 90_000);

        const [sql, valores] = repo.query.mock.calls[0] as unknown as [string, unknown[]];
        expect(sql).toContain('dispositivo_infraestructura.ultima_deteccion < nuevo.ultima_deteccion - INTERVAL ? SECOND');
        // MySQL evalúa las asignaciones en orden: la racha tiene que decidirse
        // antes de mover `ultima_deteccion`, o se compararía consigo misma.
        expect(sql.indexOf('primera_deteccion = IF(')).toBeLessThan(sql.indexOf('ultima_deteccion = GREATEST('));
        expect(valores.at(-1)).toBe(90);
    });

    it('vigentes: manuales siempre, automáticas confirmadas y junto-a-nodo sólo con permanencia', async () => {
        repo.query.mockResolvedValueOnce([{ mac_hash: 'a' }, { mac_hash: 'b' }]);
        await expect(crear().vigentes(INICIO, 1800)).resolves.toEqual(new Set(['a', 'b']));

        const [sql, valores] = repo.query.mock.calls[0] as unknown as [string, unknown[]];
        expect(sql).toContain("motivo <> 'junto-a-nodo'");
        expect(sql).toContain('TIMESTAMPDIFF(SECOND, primera_deteccion, ultima_deteccion) >= ?');
        expect(valores).toEqual([INICIO, 1800]);
    });

    it('eliminar informa si existía', async () => {
        const repositorio = crear();
        repo.query.mockResolvedValueOnce({ affectedRows: 1 } as never);
        await expect(repositorio.eliminar('a')).resolves.toBe(true);
        repo.query.mockResolvedValueOnce({} as never);
        await expect(repositorio.eliminar('a')).resolves.toBe(false);
    });
});

describe('OcupacionRepository', () => {
    it('inserta en lote salvo vacío y detecta ventanas ya consolidadas', async () => {
        const repositorio = new OcupacionRepository(dbFalsa(repo));
        await repositorio.insertMany([]);
        expect(repo.insert).not.toHaveBeenCalled();
        await repositorio.insertMany([{ idZona: 'z' } as never]);
        expect(repo.insert).toHaveBeenCalledOnce();

        repo.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
        await expect(repositorio.windowExists(INICIO)).resolves.toBe(true);
        await expect(repositorio.windowExists(INICIO)).resolves.toBe(false);
        expect(repo.count).toHaveBeenCalledWith({ where: { intervaloInicio: INICIO } });
    });

    it('última consolidación por zona con una subconsulta del máximo', async () => {
        const consulta = consultaFalsa({ getMany: [{ idZona: 'z' }] });
        repo.createQueryBuilder.mockReturnValue(consulta);

        await expect(new OcupacionRepository(dbFalsa(repo)).findLatestPerZone()).resolves.toEqual([{ idZona: 'z' }]);
        expect(consulta.innerJoin.mock.calls[0][2]).toBe('ultima.idZona = o.idZona AND ultima.maxInicio = o.intervaloInicio');
    });

    it.each([['z', 1], [null, 0]])('por rango con zona %s', async (idZona, filtros) => {
        const consulta = consultaFalsa();
        repo.createQueryBuilder.mockReturnValue(consulta);
        await new OcupacionRepository(dbFalsa(repo)).findByRange(INICIO, FIN, idZona);
        expect(consulta.andWhere).toHaveBeenCalledTimes(filtros);
        expect(consulta.orderBy).toHaveBeenCalledWith('o.intervaloInicio', 'ASC');
    });

    it.each([['z', 1], [undefined, 0]])('serie con zona %s', async (idZona, filtros) => {
        const consulta = consultaFalsa();
        repo.createQueryBuilder.mockReturnValue(consulta);
        await new OcupacionRepository(dbFalsa(repo)).findSeries(INICIO, idZona);
        expect(consulta.andWhere).toHaveBeenCalledTimes(filtros);
    });

    it.each([['z', 1], [null, 0]])('resumen por zona redondea a dos decimales (zona %s)', async (idZona, filtros) => {
        const consulta = consultaFalsa({ getRawMany: [{ idZona: 'z', nombre: 'P', ventanas: '12', promedioUnicos: '4.12345', picoUnicos: '9', promedioEstables: '2.005', ventanasAltas: '1' }] });
        repo.createQueryBuilder.mockReturnValue(consulta);

        const [fila] = await new OcupacionRepository(dbFalsa(repo)).summaryByZone(INICIO, FIN, idZona);

        expect(fila).toEqual({ idZona: 'z', nombre: 'P', ventanas: 12, promedioUnicos: 4.12, picoUnicos: 9, promedioEstables: 2.01, ventanasAltas: 1 });
        expect(consulta.andWhere).toHaveBeenCalledTimes(filtros);
    });
});

describe('SensorRepository', () => {
    it('lista, busca, crea activo con su id como nombre y marca conexión', async () => {
        const repositorio = new SensorRepository(dbFalsa(repo));
        await repositorio.findAll();
        await repositorio.findById('n1');
        await repositorio.create('n1', 'z');
        await repositorio.touch('n1', INICIO);

        expect(repo.find).toHaveBeenCalledWith({ relations: { zona: true }, order: { idSensor: 'ASC' } });
        expect(repo.findOne).toHaveBeenCalledWith({ where: { idSensor: 'n1' } });
        expect(repo.save).toHaveBeenCalledWith({ idSensor: 'n1', nombre: 'n1', idZona: 'z', estado: 'activo' });
        expect(repo.update).toHaveBeenCalledWith({ idSensor: 'n1' }, { ultimaConexion: INICIO, estado: 'activo' });
    });
});

describe('ZonaRepository', () => {
    it('lista todas, activas y busca por id', async () => {
        const repositorio = new ZonaRepository(dbFalsa(repo));
        await repositorio.findAll();
        await repositorio.findActive();
        await repositorio.findById('z');
        expect(repo.find).toHaveBeenNthCalledWith(1, { order: { nombre: 'ASC' } });
        expect(repo.find).toHaveBeenNthCalledWith(2, { where: { activa: true }, order: { nombre: 'ASC' } });
        expect(repo.findOne).toHaveBeenCalledWith({ where: { idZona: 'z' } });
    });

    it('reutiliza la zona «Sin asignar» si existe', async () => {
        repo.findOne.mockResolvedValueOnce({ idZona: 'x', nombre: ZONA_SIN_ASIGNAR });
        await expect(new ZonaRepository(dbFalsa(repo)).findOrCreateDefault()).resolves.toEqual({ idZona: 'x', nombre: ZONA_SIN_ASIGNAR });
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('crea la zona «Sin asignar» si falta', async () => {
        await new ZonaRepository(dbFalsa(repo)).findOrCreateDefault();
        expect(repo.save.mock.calls[0][0]).toMatchObject({ nombre: ZONA_SIN_ASIGNAR, capacidadMax: null, activa: true });
    });
});
