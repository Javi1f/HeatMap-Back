import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../src/modules/auth/auth.service';
import {
    ConflictError,
    EmailNotAllowedError,
    InvalidCredentialsError,
    InvalidVerificationCodeError,
    NotFoundError,
    TooManyAttemptsError,
    UnauthorizedError,
    VerificationCodeExpiredError,
} from '../../../src/common/errors';
import { cifradorFalso, loggerFalso } from '../../helpers/dobles';

const EXPIRA = new Date(Date.now() + 3_600_000);

/** Administrador tal como sale de la base, con usuario y correo cifrados. */
const adminCifrado = (campos: Record<string, unknown> = {}) => ({
    id: 5,
    username: 'enc(ana)',
    email: 'enc(ana@unbosque.edu.co)',
    password: 'hash-bcrypt',
    rol: 'admin',
    activo: true,
    ...campos,
});

/** Registro pendiente de verificación, vigente y sin intentos fallidos. */
const pendiente = (campos: Record<string, unknown> = {}) => ({
    id: 11,
    username: 'enc(ana)',
    email: 'enc(ana@unbosque.edu.co)',
    password: 'hash-bcrypt',
    code: 'enc(12345)',
    expiresAt: new Date(Date.now() + 60_000),
    attempts: 0,
    ...campos,
});

/** `AuthService` con todas sus dependencias sustituidas por dobles. */
const crear = () => {
    const dobles = {
        adminRepo: {
            findByUsernameOrEmailHash: vi.fn(),
            findByEmailHash: vi.fn(() => Promise.resolve(null)),
            findByUsernameHash: vi.fn(() => Promise.resolve(null)),
            findById: vi.fn(),
            create: vi.fn((datos: object) => Promise.resolve({ id: 5, rol: 'admin', activo: true, ...datos })),
        },
        pendingRepo: {
            findByEmailHash: vi.fn(),
            deleteByEmailHash: vi.fn(),
            deleteById: vi.fn(),
            incrementAttempts: vi.fn(),
            create: vi.fn(),
        },
        jwt: { sign: vi.fn(() => 'jwt-firmado'), expiryOf: vi.fn(() => EXPIRA), verify: vi.fn(() => ({ id: 5 })) },
        password: { hash: vi.fn(() => Promise.resolve('hash-nuevo')), verify: vi.fn(() => Promise.resolve(true)) },
        verification: { generate: vi.fn(() => '12345'), expiryDate: vi.fn(() => EXPIRA), maxAttempts: 3 },
        allowed: { isAllowed: vi.fn(() => Promise.resolve(true)) },
        mailer: { sendVerificationCode: vi.fn() },
        cipher: cifradorFalso(),
        sessions: { open: vi.fn(), closeByToken: vi.fn() },
        logger: loggerFalso(),
    };
    const servicio = new AuthService(
        dobles.adminRepo as never, dobles.pendingRepo as never, dobles.jwt as never, dobles.password as never,
        dobles.verification as never, dobles.allowed as never, dobles.mailer as never, dobles.cipher as never,
        dobles.sessions as never, dobles.logger,
    );
    return { servicio, ...dobles };
};

let entorno: ReturnType<typeof crear>;
beforeEach(() => { entorno = crear(); });

describe('AuthService.login', () => {
    it('busca por el hash de lo que se escribió, sea usuario o correo', async () => {
        entorno.adminRepo.findByUsernameOrEmailHash.mockResolvedValue(adminCifrado());
        await entorno.servicio.login({ username: 'ANA', password: 'x' });
        expect(entorno.adminRepo.findByUsernameOrEmailHash).toHaveBeenCalledWith('h(ana)');
    });

    it('devuelve la vista descifrada, el token y abre la sesión con la IP', async () => {
        entorno.adminRepo.findByUsernameOrEmailHash.mockResolvedValue(adminCifrado());

        const resultado = await entorno.servicio.login({ username: 'ana', password: 'x' }, '10.1.1.1');

        expect(resultado).toEqual({ admin: { id: 5, username: 'ana', email: 'ana@unbosque.edu.co', rol: 'admin' }, token: 'jwt-firmado' });
        expect(entorno.sessions.open).toHaveBeenCalledWith(5, 'jwt-firmado', EXPIRA, '10.1.1.1');
    });

    it('no abre sesión si el token no trae expiración', async () => {
        entorno.adminRepo.findByUsernameOrEmailHash.mockResolvedValue(adminCifrado());
        entorno.jwt.expiryOf.mockReturnValue(null as never);
        await entorno.servicio.login({ username: 'ana', password: 'x' });
        expect(entorno.sessions.open).not.toHaveBeenCalled();
    });

    it.each([
        ['el usuario no existe', null, true],
        ['la contraseña no coincide', adminCifrado(), false],
        ['la cuenta está desactivada', adminCifrado({ activo: false }), true],
    ])('responde credenciales incorrectas cuando %s', async (_caso, admin, claveOk) => {
        entorno.adminRepo.findByUsernameOrEmailHash.mockResolvedValue(admin);
        entorno.password.verify.mockResolvedValue(claveOk);
        await expect(entorno.servicio.login({ username: 'ana', password: 'x' })).rejects.toBeInstanceOf(InvalidCredentialsError);
        expect(entorno.jwt.sign).not.toHaveBeenCalled();
    });
});

describe('AuthService.register', () => {
    /** Contraseña ficticia de prueba; no es una credencial real. */
    const clave = 'Clave-segura-1'; // skipcq: SCT-A000
    const dto = { username: 'ana', email: 'ana@unbosque.edu.co', password: clave };

    it('rechaza un correo fuera de la lista blanca', async () => {
        entorno.allowed.isAllowed.mockResolvedValue(false);
        await expect(entorno.servicio.register(dto)).rejects.toBeInstanceOf(EmailNotAllowedError);
        expect(entorno.pendingRepo.create).not.toHaveBeenCalled();
    });

    it('rechaza un correo ya registrado', async () => {
        entorno.adminRepo.findByEmailHash.mockResolvedValue(adminCifrado() as never);
        await expect(entorno.servicio.register(dto)).rejects.toThrow(new ConflictError('El email ya está registrado'));
    });

    it('rechaza un nombre de usuario en uso', async () => {
        entorno.adminRepo.findByUsernameHash.mockResolvedValue(adminCifrado() as never);
        await expect(entorno.servicio.register(dto)).rejects.toThrow(new ConflictError('El username ya está en uso'));
    });

    it('limpia el pendiente anterior, guarda todo cifrado y envía el código', async () => {
        const resultado = await entorno.servicio.register(dto);

        expect(resultado).toEqual({ message: 'Código de verificación enviado al correo', verificationRequired: true });
        expect(entorno.pendingRepo.deleteByEmailHash).toHaveBeenCalledWith('h(ana@unbosque.edu.co)');
        expect(entorno.pendingRepo.create).toHaveBeenCalledWith({
            username: 'enc(ana)',
            usernameHash: 'h(ana)',
            email: 'enc(ana@unbosque.edu.co)',
            emailHash: 'h(ana@unbosque.edu.co)',
            password: 'hash-nuevo',
            code: 'enc(12345)',
            expiresAt: EXPIRA,
            attempts: 0,
        });
        expect(entorno.mailer.sendVerificationCode).toHaveBeenCalledWith('ana@unbosque.edu.co', '12345');
        expect(entorno.pendingRepo.deleteByEmailHash.mock.invocationCallOrder[0])
            .toBeLessThan(entorno.pendingRepo.create.mock.invocationCallOrder[0]);
    });
});

describe('AuthService.verifyCode', () => {
    const dto = { email: 'ana@unbosque.edu.co', code: '12345' };

    it('falla si no hay registro pendiente', async () => {
        entorno.pendingRepo.findByEmailHash.mockResolvedValue(null);
        await expect(entorno.servicio.verifyCode(dto)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('borra el pendiente caducado', async () => {
        entorno.pendingRepo.findByEmailHash.mockResolvedValue(pendiente({ expiresAt: new Date(Date.now() - 1) }));
        await expect(entorno.servicio.verifyCode(dto)).rejects.toBeInstanceOf(VerificationCodeExpiredError);
        expect(entorno.pendingRepo.deleteById).toHaveBeenCalledWith(11);
    });

    it('borra el pendiente que agotó los intentos', async () => {
        entorno.pendingRepo.findByEmailHash.mockResolvedValue(pendiente({ attempts: 3 }));
        await expect(entorno.servicio.verifyCode(dto)).rejects.toBeInstanceOf(TooManyAttemptsError);
        expect(entorno.pendingRepo.deleteById).toHaveBeenCalledWith(11);
    });

    it('cuenta el intento fallido e informa de los que quedan', async () => {
        entorno.pendingRepo.findByEmailHash.mockResolvedValue(pendiente({ attempts: 1 }));

        const error = await entorno.servicio.verifyCode({ ...dto, code: '99999' }).catch((fallo) => fallo);

        expect(error).toBeInstanceOf(InvalidVerificationCodeError);
        expect(error.details).toEqual({ attemptsLeft: 1 });
        expect(entorno.pendingRepo.incrementAttempts).toHaveBeenCalledWith(11, 1);
        expect(entorno.pendingRepo.deleteById).not.toHaveBeenCalled();
    });

    it('con el código correcto crea el admin, borra el pendiente y emite token', async () => {
        entorno.pendingRepo.findByEmailHash.mockResolvedValue(pendiente());

        const resultado = await entorno.servicio.verifyCode(dto, '10.0.0.2');

        expect(entorno.adminRepo.create).toHaveBeenCalledWith({
            username: 'enc(ana)',
            usernameHash: 'h(ana)',
            email: 'enc(ana@unbosque.edu.co)',
            emailHash: 'h(ana@unbosque.edu.co)',
            password: 'hash-bcrypt',
        });
        expect(entorno.pendingRepo.deleteById).toHaveBeenCalledWith(11);
        expect(resultado.token).toBe('jwt-firmado');
        expect(resultado.admin).toMatchObject({ id: 5, username: 'ana', email: 'ana@unbosque.edu.co' });
        expect(entorno.sessions.open).toHaveBeenCalledWith(5, 'jwt-firmado', EXPIRA, '10.0.0.2');
    });
});

describe('AuthService: sesión, cierre y cancelación', () => {
    it('cancela el registro pendiente por hash del correo', async () => {
        await entorno.servicio.cancelVerification('Ana@Unbosque.edu.co ');
        expect(entorno.pendingRepo.deleteByEmailHash).toHaveBeenCalledWith('h(ana@unbosque.edu.co)');
    });

    it('reexpone la verificación del token', () => {
        expect(entorno.servicio.verifyToken('x')).toEqual({ id: 5 });
        expect(entorno.jwt.verify).toHaveBeenCalledWith('x');
    });

    it('cierra la sesión del token cuando lo recibe', async () => {
        await expect(entorno.servicio.logout({ id: 5 } as never, 'tok')).resolves.toEqual({ message: 'Sesión cerrada exitosamente' });
        expect(entorno.sessions.closeByToken).toHaveBeenCalledWith('tok');
    });

    it('cierra sin token sin tocar sesiones', async () => {
        await entorno.servicio.logout({ id: 5 } as never);
        expect(entorno.sessions.closeByToken).not.toHaveBeenCalled();
    });

    it('la sesión devuelve el rol vigente en la base de datos, no el del token', async () => {
        entorno.adminRepo.findById.mockResolvedValue(adminCifrado({ rol: 'root' }));
        const resultado = await entorno.servicio.session({ id: 5, rol: 'admin' } as never);
        expect(resultado).toEqual({ admin: { id: 5, username: 'ana', email: 'ana@unbosque.edu.co', rol: 'root' }, isValid: true });
    });

    it.each([
        ['borrada', null],
        ['desactivada', adminCifrado({ activo: false })],
    ])('la sesión de una cuenta %s deja de ser válida', async (_caso, admin) => {
        entorno.adminRepo.findById.mockResolvedValue(admin);
        await expect(entorno.servicio.session({ id: 5 } as never)).rejects.toBeInstanceOf(UnauthorizedError);
    });
});
