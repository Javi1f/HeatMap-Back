import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AllowedEmailsController } from '../../src/modules/allowed-emails/allowed-emails.controller';
import { UsersController } from '../../src/modules/users/users.controller';
import { InvalidCredentialsError, UnauthorizedError, ValidationError } from '../../src/common/errors';
import { reqFalsa, resFalsa } from '../helpers/dobles';

/** Servicio de auditoría falso que registra las llamadas. */
const auditoriaFalsa = () => ({ registrar: vi.fn(), listar: vi.fn(() => Promise.resolve([{ id: '1' }])) });
const ADMIN = { id: 1, username: 'raiz', email: 'r@unbosque.edu.co', rol: 'root' };

describe('AuthController', () => {
    const resultado = { admin: { id: 3, username: 'ana' }, token: 'tok' };
    let servicio: Record<string, ReturnType<typeof vi.fn>>;
    let auditoria: ReturnType<typeof auditoriaFalsa>;
    let ctrl: AuthController;

    beforeEach(() => {
        servicio = {
            login: vi.fn(() => Promise.resolve(resultado)),
            register: vi.fn(() => Promise.resolve({ message: 'ok', verificationRequired: true })),
            verifyCode: vi.fn(() => Promise.resolve(resultado)),
            cancelVerification: vi.fn(),
            logout: vi.fn(() => Promise.resolve({ message: 'Sesión cerrada exitosamente' })),
            session: vi.fn(() => Promise.resolve({ admin: ADMIN, isValid: true })),
        };
        auditoria = auditoriaFalsa();
        ctrl = new AuthController(servicio as never, auditoria as never);
    });

    it('login correcto responde 200 y audita el inicio de sesión', async () => {
        const res = resFalsa();
        await ctrl.login(reqFalsa({ body: { username: 'ana', password: 'x' }, ip: '1.2.3.4' }), res);
        expect(servicio.login).toHaveBeenCalledWith({ username: 'ana', password: 'x' }, '1.2.3.4');
        expect(res.statusCode).toBe(200);
        expect(res.cuerpo).toBe(resultado);
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'inicio_sesion', idAdmin: 3, ip: '1.2.3.4' });
    });

    it('login sin IP conocida la registra como null', async () => {
        await ctrl.login(reqFalsa({ ip: undefined }), resFalsa());
        expect(servicio.login).toHaveBeenCalledWith({}, null);
    });

    it('login con credenciales incorrectas audita el intento y propaga el error', async () => {
        servicio.login.mockRejectedValue(new InvalidCredentialsError());
        await expect(ctrl.login(reqFalsa(), resFalsa())).rejects.toBeInstanceOf(InvalidCredentialsError);
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'inicio_sesion_fallido', ip: '127.0.0.1' });
    });

    it('login con otro error no lo audita como intento fallido', async () => {
        servicio.login.mockRejectedValue(new Error('base caída'));
        await expect(ctrl.login(reqFalsa(), resFalsa())).rejects.toThrow('base caída');
        expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('register responde 201', async () => {
        const res = resFalsa();
        await ctrl.register(reqFalsa({ body: { email: 'a@b.co' } }), res);
        expect(res.statusCode).toBe(201);
        expect(res.cuerpo).toEqual({ message: 'ok', verificationRequired: true });
    });

    it('verifyCode responde 200 y audita el registro completado', async () => {
        const res = resFalsa();
        await ctrl.verifyCode(reqFalsa({ body: { email: 'a@b.co', code: '12345' } }), res);
        expect(servicio.verifyCode).toHaveBeenCalledWith({ email: 'a@b.co', code: '12345' }, '127.0.0.1');
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'registro_completado', idAdmin: 3, ip: '127.0.0.1' });
        expect(res.statusCode).toBe(200);
    });

    it('verifyCode sin IP la pasa como null', async () => {
        await ctrl.verifyCode(reqFalsa({ ip: undefined }), resFalsa());
        expect(servicio.verifyCode).toHaveBeenCalledWith({}, null);
    });

    it('cancelVerification responde 200 aunque no hubiera pendiente', async () => {
        const res = resFalsa();
        await ctrl.cancelVerification(reqFalsa({ body: { email: 'a@b.co' } }), res);
        expect(servicio.cancelVerification).toHaveBeenCalledWith('a@b.co');
        expect(res.cuerpo).toEqual({ message: 'Verificación cancelada' });
    });

    it('logout cierra la sesión del token y lo audita', async () => {
        const res = resFalsa();
        await ctrl.logout(reqFalsa({ admin: ADMIN, token: 'tok' }), res);
        expect(servicio.logout).toHaveBeenCalledWith(ADMIN, 'tok');
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'cierre_sesion', idAdmin: 1, ip: '127.0.0.1' });
        expect(res.statusCode).toBe(200);
    });

    it('session devuelve los datos vigentes', async () => {
        const res = resFalsa();
        await ctrl.session(reqFalsa({ admin: ADMIN }), res);
        expect(res.cuerpo).toEqual({ admin: ADMIN, isValid: true });
    });

    it.each(['logout', 'session'] as const)('%s exige autenticación', async (metodo) => {
        await expect(ctrl[metodo](reqFalsa(), resFalsa())).rejects.toBeInstanceOf(UnauthorizedError);
    });
});

describe('AllowedEmailsController', () => {
    const servicio = {
        getAll: vi.fn(() => Promise.resolve([{ id: 1, email: 'a@b.co' }])),
        add: vi.fn(() => Promise.resolve({ id: 2, email: 'c@d.co' })),
        remove: vi.fn(),
    };
    const ctrl = new AllowedEmailsController(servicio as never);

    it('lista los correos', async () => {
        const res = resFalsa();
        await ctrl.getAll(reqFalsa(), res);
        expect(res.cuerpo).toEqual({ success: true, data: [{ id: 1, email: 'a@b.co' }] });
    });

    it('añade un correo registrando quién lo autorizó', async () => {
        const res = resFalsa();
        await ctrl.add(reqFalsa({ admin: ADMIN, body: { email: 'c@d.co' } }), res);
        expect(servicio.add).toHaveBeenCalledWith('c@d.co', 'raiz');
        expect(res.statusCode).toBe(201);
    });

    it('añadir exige autenticación', async () => {
        await expect(ctrl.add(reqFalsa(), resFalsa())).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('elimina un correo por id', async () => {
        const res = resFalsa();
        await ctrl.remove(reqFalsa({ params: { id: 4 } }), res);
        expect(servicio.remove).toHaveBeenCalledWith(4);
        expect(res.cuerpo).toEqual({ success: true, message: 'Correo eliminado de la lista' });
    });
});

describe('UsersController', () => {
    let servicio: Record<string, ReturnType<typeof vi.fn>>;
    let auditoria: ReturnType<typeof auditoriaFalsa>;
    let ctrl: UsersController;

    beforeEach(() => {
        servicio = {
            listAdmins: vi.fn(() => Promise.resolve([ADMIN])),
            listSessions: vi.fn(() => Promise.resolve([])),
            revokeSession: vi.fn(),
            cambiarRol: vi.fn(),
            cambiarActivo: vi.fn(),
        };
        auditoria = auditoriaFalsa();
        ctrl = new UsersController(servicio as never, auditoria as never);
    });

    it('lista administradores', async () => {
        const res = resFalsa();
        await ctrl.listAdmins(reqFalsa(), res);
        expect(res.cuerpo).toEqual({ success: true, data: [ADMIN] });
    });

    it('lista sesiones marcando la del token actual', async () => {
        await ctrl.listSessions(reqFalsa({ token: 'tok' }), resFalsa());
        expect(servicio.listSessions).toHaveBeenCalledWith('tok');
    });

    it('revoca una sesión y lo audita', async () => {
        const res = resFalsa();
        await ctrl.revokeSession(reqFalsa({ admin: ADMIN, params: { id: 'abc' } }), res);
        expect(servicio.revokeSession).toHaveBeenCalledWith('abc');
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'sesion_revocada', idAdmin: 1, detalle: 'sesion=abc', ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: 'Sesión cerrada' });
    });

    it('cambia el rol y lo audita', async () => {
        const res = resFalsa();
        await ctrl.cambiarRol(reqFalsa({ admin: ADMIN, params: { id: 7 }, body: { rol: 'root' } }), res);
        expect(servicio.cambiarRol).toHaveBeenCalledWith(7, 'root');
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo: 'rol_cambiado', idAdmin: 1, detalle: 'admin=7 rol=root', ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: 'Rol actualizado' });
    });

    it.each([
        [true, 'admin_activado', 'Cuenta activada'],
        [false, 'admin_desactivado', 'Cuenta desactivada'],
    ])('activo=%s se audita como %s', async (activo, tipo, mensaje) => {
        const res = resFalsa();
        await ctrl.cambiarActivo(reqFalsa({ admin: ADMIN, params: { id: 7 }, body: { activo } }), res);
        expect(servicio.cambiarActivo).toHaveBeenCalledWith(1, 7, activo);
        expect(auditoria.registrar).toHaveBeenCalledWith({ tipo, idAdmin: 1, detalle: 'admin=7', ip: '127.0.0.1' });
        expect(res.cuerpo).toEqual({ success: true, message: mensaje });
    });

    it('no audita una operación que el servicio rechazó', async () => {
        servicio.cambiarRol.mockRejectedValue(new ValidationError());
        await expect(ctrl.cambiarRol(reqFalsa({ admin: ADMIN, params: { id: 7 }, body: { rol: 'admin' } }), resFalsa())).rejects.toBeInstanceOf(ValidationError);
        expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('lista la auditoría con el límite pedido', async () => {
        const res = resFalsa();
        await ctrl.listarAuditoria(reqFalsa({ query: { limite: 20 } }), res);
        expect(auditoria.listar).toHaveBeenCalledWith(20);
        expect(res.cuerpo).toEqual({ success: true, data: [{ id: '1' }] });
    });

    it.each(['revokeSession', 'cambiarRol', 'cambiarActivo'] as const)('%s exige autenticación', async (metodo) => {
        await expect(ctrl[metodo](reqFalsa(), resFalsa())).rejects.toBeInstanceOf(UnauthorizedError);
    });
});
