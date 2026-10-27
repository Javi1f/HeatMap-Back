import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CotizacionRepository } from '../../src/persistencia/repositorios/cotizacion.repository';
import { CotizacionService } from '../../src/modules/cotizacion/cotizacion.service';
import { CrearSolicitudDto, crearSolicitudSchema } from '../../src/modules/cotizacion/cotizacion.dto';
import {
    DISPOSITIVOS_POR_NODO,
    DISPOSITIVOS_POR_PERSONA,
    estimarNodos,
    EVENTOS_PARA_DOS_RESPALDOS,
    EVENTOS_PARA_RESPALDO,
    M2_POR_NODO,
    NODOS_MINIMOS,
} from '../../src/modules/cotizacion/estimacion';
import { cifradorFalso, dbFalsa, loggerFalso, repoTypeorm } from '../helpers/dobles';

/** Solicitud de ejemplo, del tamaño del piloto de la plazoleta. */
const entradaPlazoleta = () => ({
    tipoRecinto: 'plaza-publica' as const,
    areaM2: 248,
    aforoMinimo: 50,
    aforoMaximo: 300,
    eventosAnuales: 24,
    requisitos: {
        camaras: false,
        analisisRed: false,
        seguridadPrivada: false,
        ventilacionRemota: false,
    },
});

/** Solicitud completa, tal como la manda el formulario. */
const dtoCompleto = (): CrearSolicitudDto => ({
    ...entradaPlazoleta(),
    organizacion: 'Universidad El Bosque',
    nombreContacto: 'María Pérez',
    correoContacto: 'maria@universidad.edu.co',
    telefonoContacto: '+57 300 000 0000',
    requisitos: { ...entradaPlazoleta().requisitos, notas: '' },
    aceptaDatos: true,
});

const repoFalso = () => {
    const repo = repoTypeorm();
    repo.save.mockImplementation((datos: Record<string, unknown>) =>
        Promise.resolve({ idSolicitud: 'uuid-1', fechaCreacion: new Date(), ...datos }));
    repo.findOne.mockResolvedValue({
        idSolicitud: 'uuid-1',
        tipoRecinto: 'plaza-publica',
        organizacion: 'Universidad El Bosque',
        nombreContacto: 'María Pérez',
        correoContacto: 'enc(maria@universidad.edu.co)',
        telefonoContacto: null,
        areaM2: 248,
        aforoMinimo: 50,
        aforoMaximo: 300,
        eventosAnuales: 24,
        datos: { version: 1 },
        estimacion: { nodos: 3, desglose: [], integraciones: [], notas: [] },
        estado: 'nueva',
        notasComerciales: null,
        ipOrigen: '127.0.0.1',
        fechaCreacion: new Date('2026-10-27T10:00:00Z'),
    });
    return repo;
};

const servicioCon = (repo = repoFalso()) => {
    const cipher = cifradorFalso();
    const auditoria = { registrar: vi.fn().mockResolvedValue(undefined) };
    const servicio = new CotizacionService(
        new CotizacionRepository(dbFalsa(repo)),
        cipher as never,
        auditoria as never,
        loggerFalso(),
    );
    return { servicio, repo, cipher, auditoria };
};

describe('estimarNodos', () => {
    it('reproduce el piloto de la plazoleta con tres nodos', () => {
        const estimacion = estimarNodos(entradaPlazoleta());
        expect(estimacion.nodosOperativos).toBe(NODOS_MINIMOS);
        expect(estimacion.nodos).toBe(3);
        expect(estimacion.nodosRespaldo).toBe(0);
    });

    it('el área manda sobre el aforo en recintos grandes y abiertos', () => {
        const estimacion = estimarNodos({
            ...entradaPlazoleta(),
            tipoRecinto: 'estadio',
            areaM2: 66_000,
            aforoMaximo: 40_000,
        });
        expect(estimacion.nodosOperativos).toBe(Math.ceil(66_000 / M2_POR_NODO.estadio));
        expect(estimacion.nodosOperativos).toBeGreaterThan(
            Math.ceil(40_000 * DISPOSITIVOS_POR_PERSONA / DISPOSITIVOS_POR_NODO),
        );
    });

    it('el aforo manda en recintos compactos y llenos', () => {
        const estimacion = estimarNodos({
            ...entradaPlazoleta(),
            tipoRecinto: 'auditorio',
            areaM2: 300,
            aforoMaximo: 3_000,
        });
        expect(estimacion.nodosOperativos).toBe(
            Math.ceil(3_000 * DISPOSITIVOS_POR_PERSONA / DISPOSITIVOS_POR_NODO),
        );
        expect(estimacion.nodosOperativos).toBeGreaterThan(Math.ceil(300 / M2_POR_NODO.auditorio));
    });

    it('cada desglose explica su porqué y ninguna cifra va sola', () => {
        const estimacion = estimarNodos(entradaPlazoleta());
        for (const linea of estimacion.desglose) {
            expect(linea.titulo).toBeTruthy();
            expect(linea.valor).toBeTruthy();
            expect(linea.detalle.length).toBeGreaterThan(20);
        }
    });

    it('los eventos anuales piden nodos de repuesto, nunca de cobertura', () => {
        const sin = estimarNodos(entradaPlazoleta());
        const conUno = estimarNodos({ ...entradaPlazoleta(), eventosAnuales: EVENTOS_PARA_RESPALDO });
        const conDos = estimarNodos({ ...entradaPlazoleta(), eventosAnuales: EVENTOS_PARA_DOS_RESPALDOS });
        expect(sin.nodosRespaldo).toBe(0);
        expect(conUno.nodosRespaldo).toBe(1);
        expect(conDos.nodosRespaldo).toBe(2);
        expect(conDos.nodosOperativos).toBe(conDos.nodos - 2);
    });

    it('los requisitos declarados se convierten en integraciones nombradas', () => {
        const estimacion = estimarNodos({
            ...entradaPlazoleta(),
            requisitos: {
                camaras: true,
                analisisRed: true,
                seguridadPrivada: true,
                ventilacionRemota: true,
            },
        });
        expect(estimacion.integraciones).toHaveLength(4);
        expect(estimacion.integraciones.join(' ')).toMatch(/ventilación/);
        expect(estimacion.integraciones.join(' ')).toMatch(/cámaras/);
    });

    it('declara siempre sus límites: preliminar, dispositivos y hardware', () => {
        const notas = estimarNodos(entradaPlazoleta()).notas.join(' ');
        expect(notas).toMatch(/preliminar/);
        expect(notas).toMatch(/dispositivos/i);
        expect(notas).toMatch(/Raspberry/);
    });

    it('los despliegues enormes avisan que se despliegan por fases', () => {
        const notas = estimarNodos({
            ...entradaPlazoleta(),
            tipoRecinto: 'universidad',
            areaM2: 30_000,
        }).notas.join(' ');
        expect(notas).toMatch(/fases/i);
    });
});

describe('crearSolicitudSchema', () => {
    it('rechaza un aforo máximo menor al mínimo', () => {
        const datos = { ...dtoCompleto(), aforoMaximo: 10, aforoMinimo: 50 };
        expect(crearSolicitudSchema.safeParse(datos).success).toBe(false);
    });

    it('exige la autorización de datos personales', () => {
        const datos = { ...dtoCompleto(), aceptaDatos: false };
        expect(crearSolicitudSchema.safeParse(datos).success).toBe(false);
    });

    it('coacciona los números que llegan como texto del formulario', () => {
        const datos = { ...dtoCompleto(), areaM2: '248', aforoMaximo: '300' };
        const parsed = crearSolicitudSchema.safeParse(datos);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.areaM2).toBe(248);
            expect(parsed.data.aforoMaximo).toBe(300);
        }
    });
});

describe('CotizacionService', () => {
    let repo: ReturnType<typeof repoFalso>;

    beforeEach(() => { repo = repoFalso(); });

    it('guarda el correo cifrado y el documento sin él', async () => {
        const { servicio, cipher } = servicioCon(repo);
        const resultado = await servicio.crear(dtoCompleto(), '10.0.0.1');

        expect(resultado.estimacion.nodos).toBe(3);
        const guardado = repo.save.mock.calls[0][0] as Record<string, unknown>;
        expect(guardado.correoContacto).toBe('enc(maria@universidad.edu.co)');
        expect(cipher.encrypt).toHaveBeenCalledWith('maria@universidad.edu.co');
        expect(JSON.stringify(guardado.datos)).not.toContain('maria@universidad.edu.co');
        expect(guardado.ipOrigen).toBe('10.0.0.1');
    });

    it('congela en la fila la estimación que el cliente vio', async () => {
        const { servicio } = servicioCon(repo);
        const resultado = await servicio.crear(dtoCompleto(), null);
        const guardado = repo.save.mock.calls[0][0] as Record<string, unknown>;
        expect(guardado.estimacion).toEqual(resultado.estimacion);
    });

    it('el listado no descifra correos y expone la estimación en resumen', async () => {
        const fila = await repo.findOne();
        repo.find.mockResolvedValueOnce([fila]);
        const { servicio, cipher } = servicioCon(repo);
        const lista = await servicio.listar();
        expect(cipher.decrypt).not.toHaveBeenCalled();
        expect(lista[0]).toMatchObject({ idSolicitud: 'uuid-1', nodos: 3, estado: 'nueva' });
    });

    it('abrir el detalle descifra el correo del contacto', async () => {
        const { servicio, cipher } = servicioCon(repo);
        const detalle = await servicio.obtener('uuid-1');
        expect(cipher.decrypt).toHaveBeenCalledWith('enc(maria@universidad.edu.co)');
        expect(detalle.correoContacto).toBe('maria@universidad.edu.co');
        expect(detalle.datos).toEqual({ version: 1 });
    });

    it('cambiar el estado queda registrado en la auditoría sin datos personales', async () => {
        repo.update.mockResolvedValueOnce({ affected: 1 });
        const { servicio, auditoria } = servicioCon(repo);
        await servicio.cambiarEstado('uuid-1', 'contactada', 'llamada agendada', 'admin-1', '10.0.0.1');

        expect(repo.update).toHaveBeenCalledWith(
            { idSolicitud: 'uuid-1' },
            { estado: 'contactada', notasComerciales: 'llamada agendada' },
        );
        expect(auditoria.registrar).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'cotizacion_actualizada',
                detalle: 'cotizacion uuid-1 → contactada',
            }),
        );
    });

    it('eliminar una solicitud inexistente responde 404 sin auditar', async () => {
        repo.delete.mockResolvedValueOnce({ affected: 0 });
        const { servicio, auditoria } = servicioCon(repo);
        await expect(servicio.eliminar('uuid-2', 'admin-1', null)).rejects.toMatchObject({
            statusCode: 404,
        });
        expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('el documento .json conserva la solicitud y su estimación congelada', async () => {
        const { servicio } = servicioCon(repo);
        const documento = await servicio.documento('uuid-1');
        expect(documento).toMatchObject({
            idSolicitud: 'uuid-1',
            version: 1,
            estado: 'nueva',
        });
        expect(documento.estimacion.nodos).toBe(3);
    });
});

describe('CotizacionRepository', () => {
    it('el listado filtra por estado y ordena del más reciente hacia atrás', async () => {
        const repo = repoFalso();
        const repositorio = new CotizacionRepository(dbFalsa(repo));
        await repositorio.findAll('nueva');
        expect(repo.find).toHaveBeenCalledWith({
            where: { estado: 'nueva' },
            order: { fechaCreacion: 'DESC' },
        });

        await repositorio.findAll();
        expect(repo.find).toHaveBeenLastCalledWith({
            where: {},
            order: { fechaCreacion: 'DESC' },
        });
    });

    it('actualizar y eliminar cuentan solo si tocaron una fila', async () => {
        const repo = repoFalso();
        const repositorio = new CotizacionRepository(dbFalsa(repo));
        await expect(repositorio.actualizar('uuid-1', { estado: 'cerrada' })).resolves.toBe(true);
        repo.update.mockResolvedValueOnce({ affected: 0 });
        await expect(repositorio.actualizar('x', { estado: 'cerrada' })).resolves.toBe(false);
        await expect(repositorio.deleteById('uuid-1')).resolves.toBe(true);
    });
});
