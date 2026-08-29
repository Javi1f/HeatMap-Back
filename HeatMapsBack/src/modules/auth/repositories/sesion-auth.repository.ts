import { injectable } from 'tsyringe';
import { LessThan, Repository } from 'typeorm';
import { SesionAuth } from '../../../models/SesionAuth.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Acceso a las sesiones de administrador.
 */
@injectable()
export class SesionAuthRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<SesionAuth>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(SesionAuth);
    }

    /** Persiste una sesion recien abierta. */
    create(data: Partial<SesionAuth>): Promise<SesionAuth> {
        return this.repo.save(this.repo.create(data));
    }

    /** Busca la sesion asociada a la huella de un token. */
    findByTokenHash(tokenHash: string): Promise<SesionAuth | null> {
        return this.repo.findOne({ where: { tokenHash } });
    }

    /** Busca una sesion por su identificador. */
    findById(idSesion: string): Promise<SesionAuth | null> {
        return this.repo.findOne({ where: { idSesion } });
    }

    /** Sesiones vivas: no revocadas y aún dentro de su ventana de validez. */
    findActive(): Promise<SesionAuth[]> {
        return this.repo
            .createQueryBuilder('s')
            .where('s.revocada = false')
            .andWhere('s.fechaExpiracion > :now', { now: new Date() })
            .orderBy('s.fechaInicio', 'DESC')
            .getMany();
    }

    /**
     * Revoca una sesion abierta.
     *
     * @returns `true` si existia y seguia abierta.
     */
    async revokeById(idSesion: string): Promise<boolean> {
        const result = await this.repo.update({ idSesion, revocada: false }, { revocada: true });
        return (result.affected ?? 0) > 0;
    }

    /** Revoca la sesion asociada a un token. Idempotente. */
    async revokeByTokenHash(tokenHash: string): Promise<void> {
        await this.repo.update({ tokenHash }, { revocada: true });
    }

    /**
     * Borra las sesiones ya expiradas.
     *
     * Una sesión caducada no aporta nada: el propio JWT ya no verifica, así
     * que conservarla solo hace crecer la tabla.
     *
     * @returns Filas eliminadas.
     */
    async purgeExpired(): Promise<number> {
        const result = await this.repo.delete({ fechaExpiracion: LessThan(new Date()) });
        return result.affected ?? 0;
    }
}
