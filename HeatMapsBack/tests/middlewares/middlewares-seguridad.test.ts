import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { authMiddleware } from '../../src/middlewares/auth.middleware';
import { requireRoot } from '../../src/middlewares/require-root.middleware';
import { decryptRequest, encryptResponse } from '../../src/middlewares/crypto.middleware';
import { JwtService } from '../../src/modules/auth/services/jwt.service';
import { SessionService } from '../../src/modules/auth/services/session.service';
import { AdminRepository } from '../../src/modules/auth/repositories/admin.repository';
import { ApiPayloadCipher } from '../../src/crypto/api-payload.crypto';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../src/common/errors';
import { nextFalso, reqFalsa, resFalsa } from '../helpers/dobles';

afterEach(() => {
    container.clearInstances();
    vi.restoreAllMocks();
});

describe('authMiddleware', () => {
    /** Registra un `JwtService` y un `SessionService` falsos en el contenedor. */
    const preparar = (verify: () => unknown, activa = true) => {
        container.registerInstance(JwtService, { verify: vi.fn(verify) } as unknown as JwtService);
        container.registerInstance(SessionService, { isActive: vi.fn(() => Promise.resolve(activa)) } as unknown as SessionService);
    };

    it.each([
        ['sin cabecera', {}],
        ['con un esquema distinto de Bearer', { authorization: 'Basic abc' }],
        ['con Bearer vacío', { authorization: 'Bearer   ' }],
    ])('rechaza %s', async (_caso, headers) => {
        preparar(() => ({ id: 1 }));
        const next = nextFalso();
        await authMiddleware(reqFalsa({ headers }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    });

    it('propaga el error de un token inválido', async () => {
        preparar(() => { throw new UnauthorizedError('Token inválido o expirado'); });
        const next = nextFalso();
        await authMiddleware(reqFalsa({ headers: { authorization: 'Bearer malo' } }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    });

    it('rechaza una sesión revocada aunque el token sea válido', async () => {
        preparar(() => ({ id: 1 }), false);
        const next = nextFalso();
        await authMiddleware(reqFalsa({ headers: { authorization: 'Bearer bueno' } }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    });

    it('deja pasar y adjunta el administrador y el token', async () => {
        preparar(() => ({ id: 9, username: 'ana', email: 'a@b.co' }));
        const req = reqFalsa({ headers: { authorization: 'Bearer bueno' } });
        const next = nextFalso();

        await authMiddleware(req, resFalsa(), next);

        expect(next).toHaveBeenCalledWith();
        expect(req.admin).toEqual({ id: 9, username: 'ana', email: 'a@b.co' });
        expect(req.token).toBe('bueno');
    });
});

describe('requireRoot', () => {
    /** Registra un repositorio de administradores que devuelve `admin`. */
    const preparar = (admin: unknown) => {
        container.registerInstance(AdminRepository, { findById: vi.fn(() => Promise.resolve(admin)) } as unknown as AdminRepository);
    };

    it('exige haber pasado por la autenticación', async () => {
        preparar(null);
        const next = nextFalso();
        await requireRoot(reqFalsa(), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    });

    it.each([
        ['una cuenta que ya no existe', null],
        ['una cuenta desactivada', { rol: 'root', activo: false }],
    ])('rechaza con 401 %s', async (_caso, admin) => {
        preparar(admin);
        const next = nextFalso();
        await requireRoot(reqFalsa({ admin: { id: 1 } }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(UnauthorizedError);
    });

    it('rechaza con 403 a un admin sin rol root', async () => {
        preparar({ rol: 'admin', activo: true });
        const next = nextFalso();
        await requireRoot(reqFalsa({ admin: { id: 2 } }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
    });

    it('deja pasar a un root activo y consulta el rol en la base de datos', async () => {
        preparar({ rol: 'root', activo: true });
        const next = nextFalso();
        await requireRoot(reqFalsa({ admin: { id: 1, rol: 'admin' } }), resFalsa(), next);
        expect(next).toHaveBeenCalledWith();
        expect(container.resolve(AdminRepository).findById).toHaveBeenCalledWith(1);
    });
});

describe('cifrado de la API', () => {
    /** Cifrador real de la API, con la clave del entorno de pruebas. */
    const cifrador = () => container.resolve(ApiPayloadCipher);

    it('descifra un cuerpo cifrado y lo sustituye', () => {
        const req = reqFalsa({ body: { data: cifrador().encrypt({ rol: 'root' }) } });
        const next = nextFalso();
        decryptRequest(req, resFalsa(), next);
        expect(req.body).toEqual({ rol: 'root' });
        expect(next).toHaveBeenCalledWith();
    });

    it('deja pasar sin tocar las peticiones sin cuerpo cifrado', () => {
        const req = reqFalsa({ body: { plano: 1 } });
        const next = nextFalso();
        decryptRequest(req, resFalsa(), next);
        expect(req.body).toEqual({ plano: 1 });
        expect(next).toHaveBeenCalledWith();
    });

    it('rechaza un cuerpo cifrado corrupto', () => {
        const next = nextFalso();
        decryptRequest(reqFalsa({ body: { data: 'no-es-base64-valido' } }), resFalsa(), next);
        expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
    });

    it('cifra toda respuesta JSON', () => {
        const res = resFalsa();
        const jsonOriginal = res.json;
        encryptResponse(reqFalsa(), res, nextFalso());

        res.json({ success: true, data: [1, 2] });

        const enviado = jsonOriginal.mock.calls[0][0] as { data: string };
        expect(Object.keys(enviado)).toEqual(['data']);
        expect(cifrador().decrypt(enviado.data)).toEqual({ success: true, data: [1, 2] });
    });
});

describe('ApiPayloadCipher', () => {
    const cifrador = container.resolve(ApiPayloadCipher);

    it('usa un IV aleatorio: el mismo dato da cifrados distintos', () => {
        expect(cifrador.encrypt({ a: 1 })).not.toBe(cifrador.encrypt({ a: 1 }));
    });

    it('detecta cualquier alteración gracias a la etiqueta GCM', () => {
        const bytes = Buffer.from(cifrador.encrypt({ a: 1 }), 'base64');
        bytes[bytes.length - 1] ^= 0xff;
        expect(() => cifrador.decrypt(bytes.toString('base64'))).toThrow();
    });

    it('no descifra con otra clave', () => {
        const otro = new ApiPayloadCipher({ frontendEncryptionKey: Buffer.alloc(32, 7) } as never);
        expect(() => otro.decrypt(cifrador.encrypt({ a: 1 }))).toThrow();
    });
});
