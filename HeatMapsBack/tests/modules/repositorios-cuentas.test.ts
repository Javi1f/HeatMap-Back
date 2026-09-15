import { beforeEach, describe, expect, it } from 'vitest';
import { LessThan } from 'typeorm';
import { AdminRepository } from '../../src/modules/auth/repositories/admin.repository';
import { PendingRegistrationRepository } from '../../src/modules/auth/repositories/pending-registration.repository';
import { SesionAuthRepository } from '../../src/modules/auth/repositories/sesion-auth.repository';
import { AllowedEmailRepository } from '../../src/modules/allowed-emails/repositories/allowed-email.repository';
import { consultaFalsa, dbFalsa, repoTypeorm } from '../helpers/dobles';

let repo: ReturnType<typeof repoTypeorm>;
beforeEach(() => { repo = repoTypeorm(); });

describe('AdminRepository', () => {
    it('el login busca por hash de correo o de usuario', async () => {
        await new AdminRepository(dbFalsa(repo)).findByUsernameOrEmailHash('h');
        expect(repo.findOne).toHaveBeenCalledWith({ where: [{ emailHash: 'h' }, { usernameHash: 'h' }] });
    });

    it('delega búsquedas, alta, listado y actualización', async () => {
        const repositorio = new AdminRepository(dbFalsa(repo));
        await repositorio.findByEmailHash('e');
        await repositorio.findByUsernameHash('u');
        await repositorio.findById(3);
        await repositorio.findAll();
        await repositorio.create({ usernameHash: 'u' });
        await repositorio.actualizar(3, { rol: 'root' });

        expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { emailHash: 'e' } });
        expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { usernameHash: 'u' } });
        expect(repo.findOne).toHaveBeenNthCalledWith(3, { where: { id: 3 } });
        expect(repo.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
        expect(repo.save).toHaveBeenCalledWith({ usernameHash: 'u' });
        expect(repo.update).toHaveBeenCalledWith({ id: 3 }, { rol: 'root' });
    });
});

describe('PendingRegistrationRepository', () => {
    it('opera sobre el registro pendiente', async () => {
        const repositorio = new PendingRegistrationRepository(dbFalsa(repo));
        await repositorio.findByEmailHash('e');
        await repositorio.deleteByEmailHash('e');
        await repositorio.deleteById(4);
        await repositorio.incrementAttempts(4, 2);
        await repositorio.create({ emailHash: 'e' });

        expect(repo.findOne).toHaveBeenCalledWith({ where: { emailHash: 'e' } });
        expect(repo.delete).toHaveBeenNthCalledWith(1, { emailHash: 'e' });
        expect(repo.delete).toHaveBeenNthCalledWith(2, { id: 4 });
        expect(repo.update).toHaveBeenCalledWith(4, { attempts: 3 });
        expect(repo.save).toHaveBeenCalledWith({ emailHash: 'e' });
    });
});

describe('SesionAuthRepository', () => {
    it('crea y busca sesiones', async () => {
        const repositorio = new SesionAuthRepository(dbFalsa(repo));
        await repositorio.create({ tokenHash: 't' });
        await repositorio.findByTokenHash('t');
        await repositorio.findById('s');
        expect(repo.save).toHaveBeenCalledWith({ tokenHash: 't' });
        expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { tokenHash: 't' } });
        expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { idSesion: 's' } });
    });

    it('las sesiones activas excluyen revocadas y caducadas', async () => {
        const consulta = consultaFalsa({ getMany: [{ idSesion: 's' }] });
        repo.createQueryBuilder.mockReturnValue(consulta);

        await expect(new SesionAuthRepository(dbFalsa(repo)).findActive()).resolves.toEqual([{ idSesion: 's' }]);

        expect(consulta.where).toHaveBeenCalledWith('s.revocada = false');
        expect(consulta.andWhere.mock.calls[0][0]).toBe('s.fechaExpiracion > :now');
        expect(consulta.orderBy).toHaveBeenCalledWith('s.fechaInicio', 'DESC');
    });

    it('revokeById solo cuenta si la sesión seguía abierta', async () => {
        const repositorio = new SesionAuthRepository(dbFalsa(repo));
        repo.update.mockResolvedValueOnce({ affected: 1 });
        await expect(repositorio.revokeById('s')).resolves.toBe(true);
        repo.update.mockResolvedValueOnce({ affected: 0 });
        await expect(repositorio.revokeById('s')).resolves.toBe(false);
        repo.update.mockResolvedValueOnce({} as never);
        await expect(repositorio.revokeById('s')).resolves.toBe(false);
        expect(repo.update).toHaveBeenCalledWith({ idSesion: 's', revocada: false }, { revocada: true });
    });

    it('revoca todas las de un admin y por token', async () => {
        const repositorio = new SesionAuthRepository(dbFalsa(repo));
        repo.update.mockResolvedValueOnce({ affected: 3 });
        await expect(repositorio.revokeAllForAdmin(2)).resolves.toBe(3);
        repo.update.mockResolvedValueOnce({} as never);
        await expect(repositorio.revokeAllForAdmin(2)).resolves.toBe(0);
        await repositorio.revokeByTokenHash('t');
        expect(repo.update).toHaveBeenLastCalledWith({ tokenHash: 't' }, { revocada: true });
    });

    it('purga las caducadas', async () => {
        const repositorio = new SesionAuthRepository(dbFalsa(repo));
        repo.delete.mockResolvedValueOnce({ affected: 4 });
        await expect(repositorio.purgeExpired()).resolves.toBe(4);
        repo.delete.mockResolvedValueOnce({} as never);
        await expect(repositorio.purgeExpired()).resolves.toBe(0);
        const criterio = (repo.delete.mock.calls[0] as unknown[])[0] as { fechaExpiracion: unknown };
        expect(criterio.fechaExpiracion).toMatchObject({ type: LessThan(new Date()).type });
    });
});

describe('AllowedEmailRepository', () => {
    it('opera sobre la lista blanca', async () => {
        const repositorio = new AllowedEmailRepository(dbFalsa(repo));
        await repositorio.findAll();
        await repositorio.findById(1);
        await repositorio.findByEmailHash('e');
        await repositorio.create({ emailHash: 'e' });
        await repositorio.deleteById(1);

        expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
        expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { id: 1 } });
        expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { emailHash: 'e' } });
        expect(repo.save).toHaveBeenCalledWith({ emailHash: 'e' });
        expect(repo.delete).toHaveBeenCalledWith(1);
    });
});
