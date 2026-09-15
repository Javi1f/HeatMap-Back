import { describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import jwt from 'jsonwebtoken';
import { JwtService } from '../../../../src/modules/auth/services/jwt.service';
import { PasswordService } from '../../../../src/modules/auth/services/password.service';
import { SessionService } from '../../../../src/modules/auth/services/session.service';
import { VerificationCodeService } from '../../../../src/modules/auth/services/verification-code.service';
import { AppConfig } from '../../../../src/config/app.config';
import { UnauthorizedError } from '../../../../src/common/errors';
import { loggerFalso } from '../../../helpers/dobles';

describe('JwtService', () => {
    const servicio = container.resolve(JwtService);
    const payload = { id: 7, username: 'ana', email: 'ana@unbosque.edu.co', rol: 'admin' as const };

    it('firma y verifica un token', () => {
        const token = servicio.sign(payload);
        expect(servicio.verify(token)).toMatchObject(payload);
    });

    it('caduca en una hora como máximo', () => {
        const expira = servicio.expiryOf(servicio.sign(payload));
        expect(expira).not.toBeNull();
        const horas = ((expira as Date).getTime() - Date.now()) / 3_600_000;
        expect(horas).toBeGreaterThan(0.99);
        expect(horas).toBeLessThanOrEqual(1);
    });

    it('rechaza un token alterado', () => {
        const token = servicio.sign(payload);
        const alterado = `${token.slice(0, -2)}xx`;
        expect(() => servicio.verify(alterado)).toThrow(UnauthorizedError);
    });

    it('rechaza un token firmado con otra clave', () => {
        const ajeno = jwt.sign(payload, 'otra-clave');
        expect(() => servicio.verify(ajeno)).toThrow(UnauthorizedError);
    });

    it('rechaza un token caducado', () => {
        const caducado = jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 60 }, container.resolve(AppConfig).auth.jwtSecret);
        expect(() => servicio.verify(caducado)).toThrow(UnauthorizedError);
    });

    it('expiryOf devuelve null si el token no trae expiración o no es un JWT', () => {
        expect(servicio.expiryOf('no-es-un-token')).toBeNull();
        expect(servicio.expiryOf(jwt.sign({ id: 1 }, 'k', { noTimestamp: true }))).toBeNull();
    });
});

describe('PasswordService', () => {
    const servicio = new PasswordService();

    it('no guarda la contraseña en claro y la verifica', async () => {
        const hash = await servicio.hash('Contraseña-Segura-1');
        expect(hash).not.toContain('Contraseña-Segura-1');
        expect(hash.startsWith('$2')).toBe(true);
        await expect(servicio.verify('Contraseña-Segura-1', hash)).resolves.toBe(true);
    });

    it('rechaza una contraseña distinta', async () => {
        const hash = await servicio.hash('correcta');
        await expect(servicio.verify('incorrecta', hash)).resolves.toBe(false);
    });

    it('genera un hash distinto cada vez (sal aleatoria)', async () => {
        const [primero, segundo] = await Promise.all([servicio.hash('igual'), servicio.hash('igual')]);
        expect(primero).not.toBe(segundo);
    });
});

describe('SessionService', () => {
    /** Repositorio de sesiones falso. */
    const repoFalso = () => ({
        create: vi.fn((datos) => Promise.resolve(datos)),
        findByTokenHash: vi.fn(),
        revokeByTokenHash: vi.fn(),
        revokeById: vi.fn(),
        revokeAllForAdmin: vi.fn(() => Promise.resolve(2)),
        findActive: vi.fn(() => Promise.resolve([])),
        purgeExpired: vi.fn(() => Promise.resolve(5)),
    });

    it('guarda la huella SHA-256 del token, nunca el token', async () => {
        const repo = repoFalso();
        const servicio = new SessionService(repo as never, loggerFalso());
        const expira = new Date(Date.now() + 60_000);

        await servicio.open(3, 'token-secreto', expira, '10.0.0.1');

        const guardado = repo.create.mock.calls[0][0];
        expect(guardado).toEqual({ idAdmin: 3, tokenHash: servicio.fingerprint('token-secreto'), ipOrigen: '10.0.0.1', fechaExpiracion: expira, revocada: false });
        expect(JSON.stringify(guardado)).not.toContain('token-secreto');
        expect(servicio.fingerprint('token-secreto')).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
        ['sin sesión registrada', null, true],
        ['revocada', { revocada: true, fechaExpiracion: new Date(Date.now() + 60_000) }, false],
        ['caducada', { revocada: false, fechaExpiracion: new Date(Date.now() - 1) }, false],
        ['vigente', { revocada: false, fechaExpiracion: new Date(Date.now() + 60_000) }, true],
    ])('isActive con una sesión %s', async (_caso, sesion, esperado) => {
        const repo = repoFalso();
        repo.findByTokenHash.mockResolvedValue(sesion);
        const servicio = new SessionService(repo as never, loggerFalso());
        await expect(servicio.isActive('t')).resolves.toBe(esperado);
    });

    it('cierra por token usando su huella', async () => {
        const repo = repoFalso();
        const servicio = new SessionService(repo as never, loggerFalso());
        await servicio.closeByToken('abc');
        expect(repo.revokeByTokenHash).toHaveBeenCalledWith(servicio.fingerprint('abc'));
    });

    it('registra en el log solo las revocaciones efectivas', async () => {
        const repo = repoFalso();
        const logger = loggerFalso();
        const servicio = new SessionService(repo as never, logger);

        repo.revokeById.mockResolvedValueOnce(true);
        await expect(servicio.revoke('s1')).resolves.toBe(true);
        repo.revokeById.mockResolvedValueOnce(false);
        await expect(servicio.revoke('s2')).resolves.toBe(false);

        expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('delega en el repositorio la revocación masiva, el listado y la purga', async () => {
        const repo = repoFalso();
        const servicio = new SessionService(repo as never, loggerFalso());
        await expect(servicio.revokeAllFor(4)).resolves.toBe(2);
        await expect(servicio.listActive()).resolves.toEqual([]);
        await expect(servicio.purgeExpired()).resolves.toBe(5);
        expect(repo.revokeAllForAdmin).toHaveBeenCalledWith(4);
    });
});

describe('VerificationCodeService', () => {
    const cfg = { auth: { verificationCodeExpiresMinutes: 10, maxVerificationAttempts: 3 } } as AppConfig;
    const servicio = new VerificationCodeService(cfg);

    it('genera códigos de 5 dígitos', () => {
        for (let i = 0; i < 50; i++) expect(servicio.generate()).toMatch(/^\d{5}$/);
    });

    it('calcula la expiración con los minutos configurados', () => {
        const antes = Date.now();
        const expira = servicio.expiryDate().getTime();
        expect(expira - antes).toBeGreaterThanOrEqual(10 * 60_000);
        expect(expira - antes).toBeLessThan(10 * 60_000 + 1000);
    });

    it('expone el máximo de intentos configurado', () => {
        expect(servicio.maxAttempts).toBe(3);
    });
});
