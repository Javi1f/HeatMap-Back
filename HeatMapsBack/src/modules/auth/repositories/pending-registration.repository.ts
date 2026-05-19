import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { PendingRegistration } from '../../../models/PendingRegistration.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Contrato del repositorio de registros pendientes de verificación por correo.
 */
export interface IPendingRegistrationRepository {
    findByEmailHash(emailHash: string): Promise<PendingRegistration | null>;
    deleteByEmailHash(emailHash: string): Promise<void>;
    deleteById(id: number): Promise<void>;
    incrementAttempts(id: number, currentAttempts: number): Promise<void>;
    create(data: Partial<PendingRegistration>): Promise<PendingRegistration>;
}

@injectable()
export class PendingRegistrationRepository implements IPendingRegistrationRepository {
    private readonly repo: Repository<PendingRegistration>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(PendingRegistration);
    }

    findByEmailHash(emailHash: string): Promise<PendingRegistration | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    async deleteByEmailHash(emailHash: string): Promise<void> {
        await this.repo.delete({ emailHash });
    }

    async deleteById(id: number): Promise<void> {
        await this.repo.delete({ id });
    }

    async incrementAttempts(id: number, currentAttempts: number): Promise<void> {
        await this.repo.update(id, { attempts: currentAttempts + 1 });
    }

    async create(data: Partial<PendingRegistration>): Promise<PendingRegistration> {
        return this.repo.save(this.repo.create(data));
    }
}
