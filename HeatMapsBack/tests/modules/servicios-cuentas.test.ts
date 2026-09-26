import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllowedEmailsService } from '../../src/modules/identidad/correos-permitidos/allowed-emails.service';
import { UsersService } from '../../src/modules/identidad/usuarios/users.service';
import { AuditoriaService } from '../../src/modules/identidad/usuarios/auditoria.service';
import { AuditoriaRepository } from '../../src/persistencia/repositorios/auditoria.repository';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/common/errors';
import { cifradorFalso, dbFalsa, loggerFalso, repoTypeorm } from '../helpers/dobles';

describe('AllowedEmailsService', () => {
    const creado = new Date('2026-09-01T10:00:00Z');
    /** Administrador que hace las peticiones. */
    const RAIZ = { id: '11111111-1111-4111-8111-111111111111', username: 'raiz', email: 'raiz@b.co' };
    let repo: Record<string, ReturnType<typeof vi.fn>>;
    let servicio: AllowedEmailsService;

    beforeEach(() => {
        repo = {
            findAll: vi.fn(() => Promise.resolve([
                { id: 'c1', email: 'enc(a@b.co)', autor: { username: 'enc(raiz)' }, createdAt: creado, esFundador: false },
                { id: 'c2', email: 'enc(c@d.co)', autor: null, createdAt: creado, esFundador: true },
            ])),
            findByEmailHash: vi.fn(() => Promise.resolve(null)),
            findById: vi.fn(() => Promise.resolve(null)),
            create: vi.fn((datos: object) => Promise.resolve({ id: 'c9', createdAt: creado, ...datos })),
            deleteById: vi.fn(),
        };
        servicio = new AllowedEmailsService(repo as never, cifradorFalso() as never);
    });

    it('lista los correos descifrados con el nombre de quien los autorizó y la marca de fundador', async () => {
        await expect(servicio.getAll()).resolves.toEqual([
            { id: 'c1', email: 'a@b.co', addedBy: 'raiz', createdAt: creado, esFundador: false },
            { id: 'c2', email: 'c@d.co', addedBy: null, createdAt: creado, esFundador: true },
        ]);
    });

    it('añade un correo cifrado con su hash, a nombre del administrador que lo pide', async () => {
        const vista = await servicio.add('nuevo@b.co', RAIZ);
        expect(repo.create).toHaveBeenCalledWith({
            email: 'enc(nuevo@b.co)', emailHash: 'h(nuevo@b.co)', anadidoPor: RAIZ.id, esFundador: false,
        });
        expect(vista).toEqual({ id: 'c9', email: 'nuevo@b.co', addedBy: 'raiz', createdAt: creado, esFundador: false });
    });

    it('no admite correos repetidos', async () => {
        repo.findByEmailHash.mockResolvedValue({ id: 'c1' });
        await expect(servicio.add('a@b.co', RAIZ)).rejects.toBeInstanceOf(ConflictError);
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('elimina un correo existente', async () => {
        repo.findById.mockResolvedValue({ id: 'c1', emailHash: 'h(a@b.co)', esFundador: false });
        await servicio.remove('c1', RAIZ);
        expect(repo.deleteById).toHaveBeenCalledWith('c1');
    });

    it('el servidor protege el correo fundador y el propio, aunque se pida a mano', async () => {
        repo.findById.mockResolvedValueOnce({ id: 'c2', emailHash: 'h(c@d.co)', esFundador: true });
        await expect(servicio.remove('c2', RAIZ)).rejects.toThrow(new ForbiddenError('No se puede eliminar el correo fundador'));

        repo.findById.mockResolvedValueOnce({ id: 'c3', emailHash: 'h(raiz@b.co)', esFundador: false });
        await expect(servicio.remove('c3', RAIZ)).rejects.toThrow(new ForbiddenError('No puedes eliminar tu propio correo'));
        expect(repo.deleteById).not.toHaveBeenCalled();
    });

    it('eliminar uno inexistente da 404', async () => {
        await expect(servicio.remove('no-existe', RAIZ)).rejects.toBeInstanceOf(NotFoundError);
        expect(repo.deleteById).not.toHaveBeenCalled();
    });

    it('isAllowed compara por hash normalizado', async () => {
        repo.findByEmailHash.mockImplementation((hash: string) => Promise.resolve(hash === 'h(a@b.co)' ? { id: 1 } : null));
        await expect(servicio.isAllowed(' A@B.co')).resolves.toBe(true);
        await expect(servicio.isAllowed('otro@b.co')).resolves.toBe(false);
    });
});

describe('UsersService', () => {
    const fecha = new Date('2026-09-10T08:00:00Z');
    /** Administrador con los campos cifrados como los guarda la base. */
    const admin = (id: number, rol: string, activo = true) => ({
        id, rol, activo, username: `enc(u${id})`, email: `enc(u${id}@b.co)`, isVerified: true, createdAt: fecha,
    });
    let admins: Record<string, ReturnType<typeof vi.fn>>;
    let sesiones: Record<string, ReturnType<typeof vi.fn>>;
    let servicio: UsersService;

    beforeEach(() => {
        admins = {
            findAll: vi.fn(() => Promise.resolve([admin(1, 'root'), admin(2, 'admin'), admin(3, 'root', false)])),
            actualizar: vi.fn(),
        };
        sesiones = {
            listActive: vi.fn(() => Promise.resolve([
                { idSesion: 's1', idAdmin: 2, tokenHash: 'huella(tok)', ipOrigen: '1.1.1.1', fechaInicio: fecha, fechaExpiracion: fecha },
                { idSesion: 's2', idAdmin: 99, tokenHash: 'otra', ipOrigen: null, fechaInicio: fecha, fechaExpiracion: fecha },
            ])),
            fingerprint: vi.fn((token: string) => `huella(${token})`),
            revoke: vi.fn(() => Promise.resolve(true)),
            revokeAllFor: vi.fn(),
        };
        servicio = new UsersService(admins as never, sesiones as never, cifradorFalso() as never);
    });

    it('lista administradores descifrados indicando quién tiene sesión viva', async () => {
        const lista = await servicio.listAdmins();
        expect(lista[1]).toEqual({
            id: 2, username: 'u2', email: 'u2@b.co', isVerified: true, createdAt: fecha.toISOString(),
            conSesionActiva: true, rol: 'admin', activo: true,
        });
        expect(lista.map((resumen) => resumen.conSesionActiva)).toEqual([false, true, false]);
    });

    it('lista sesiones con el nombre del titular y marca la actual', async () => {
        const lista = await servicio.listSessions('tok');
        expect(lista[0]).toEqual({
            idSesion: 's1', idAdmin: 2, username: 'u2', ipOrigen: '1.1.1.1',
            fechaInicio: fecha.toISOString(), fechaExpiracion: fecha.toISOString(), esActual: true,
        });
        expect(lista[1]).toMatchObject({ username: null, esActual: false });
    });

    it('sin token ninguna sesión es la actual', async () => {
        const lista = await servicio.listSessions();
        expect(lista.every((sesion) => !sesion.esActual)).toBe(true);
        expect(sesiones.fingerprint).not.toHaveBeenCalled();
    });

    it('revocar una sesión inexistente da 404', async () => {
        await servicio.revokeSession('s1');
        sesiones.revoke.mockResolvedValue(false);
        await expect(servicio.revokeSession('nada')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('cambia el rol si las reglas lo permiten', async () => {
        await servicio.cambiarRol(2, 'root');
        expect(admins.actualizar).toHaveBeenCalledWith(2, { rol: 'root' });
    });

    it('no quita el rol al último root activo', async () => {
        await expect(servicio.cambiarRol(1, 'admin')).rejects.toBeInstanceOf(ConflictError);
        expect(admins.actualizar).not.toHaveBeenCalled();
    });

    it('desactivar una cuenta revoca todas sus sesiones', async () => {
        await servicio.cambiarActivo(1, 2, false);
        expect(admins.actualizar).toHaveBeenCalledWith(2, { activo: false });
        expect(sesiones.revokeAllFor).toHaveBeenCalledWith(2);
    });

    it('activar una cuenta no revoca sesiones', async () => {
        await servicio.cambiarActivo(1, 3, true);
        expect(admins.actualizar).toHaveBeenCalledWith(3, { activo: true });
        expect(sesiones.revokeAllFor).not.toHaveBeenCalled();
    });

    it('nadie puede desactivarse a sí mismo', async () => {
        await expect(servicio.cambiarActivo(2, 2, false)).rejects.toBeInstanceOf(ConflictError);
    });
});

describe('AuditoriaService', () => {
    it('registra el evento recortando detalle e IP al tamaño de sus columnas', async () => {
        const repo = repoTypeorm();
        const servicio = new AuditoriaService(new AuditoriaRepository(dbFalsa(repo) as never), loggerFalso());

        await servicio.registrar({ tipo: 'rol_cambiado', idAdmin: 1, detalle: 'x'.repeat(300), ip: 'y'.repeat(60) });

        expect(repo.insert).toHaveBeenCalledWith({ tipo: 'rol_cambiado', idAdmin: 1, detalle: 'x'.repeat(255), ipOrigen: 'y'.repeat(45) });
    });

    it('usa null en los campos ausentes', async () => {
        const repo = repoTypeorm();
        await new AuditoriaService(new AuditoriaRepository(dbFalsa(repo) as never), loggerFalso()).registrar({ tipo: 'inicio_sesion_fallido' });
        expect(repo.insert).toHaveBeenCalledWith({ tipo: 'inicio_sesion_fallido', idAdmin: null, detalle: null, ipOrigen: null });
    });

    it('nunca lanza: si la base falla lo deja en el log', async () => {
        const repo = repoTypeorm();
        repo.insert.mockRejectedValue(new Error('sin conexión'));
        const logger = loggerFalso();

        await expect(new AuditoriaService(new AuditoriaRepository(dbFalsa(repo) as never), logger).registrar({ tipo: 'cierre_sesion' })).resolves.toBeUndefined();
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('lista los últimos eventos en formato del panel', async () => {
        const repo = repoTypeorm();
        const fecha = new Date('2026-09-14T12:00:00.123Z');
        repo.find.mockResolvedValue([{ idEvento: '8', fecha, idAdmin: 1, tipo: 'inicio_sesion', detalle: null, ipOrigen: '1.1.1.1' }]);

        const lista = await new AuditoriaService(new AuditoriaRepository(dbFalsa(repo) as never), loggerFalso()).listar(50);

        expect(repo.find).toHaveBeenCalledWith({ order: { fecha: 'DESC' }, take: 50 });
        expect(lista).toEqual([{ id: '8', fecha: '2026-09-14T12:00:00.123Z', idAdmin: 1, tipo: 'inicio_sesion', detalle: null, ipOrigen: '1.1.1.1' }]);
    });
});
