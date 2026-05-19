import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { AllowedEmail } from '../../../models/AllowedEmail.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Contrato del repositorio de correos permitidos para registro.
 */
export interface IAllowedEmailRepository {
    findAll(): Promise<AllowedEmail[]>;
    findById(id: number): Promise<AllowedEmail | null>;
    findByEmailHash(emailHash: string): Promise<AllowedEmail | null>;
    create(data: Partial<AllowedEmail>): Promise<AllowedEmail>;
    deleteById(id: number): Promise<void>;
}

@injectable()
export class AllowedEmailRepository implements IAllowedEmailRepository {
    private readonly repo: Repository<AllowedEmail>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(AllowedEmail);
    }

    findAll(): Promise<AllowedEmail[]> {
        return this.repo.find({ order: { createdAt: 'DESC' } });
    }

    findById(id: number): Promise<AllowedEmail | null> {
        return this.repo.findOne({ where: { id } });
    }

    findByEmailHash(emailHash: string): Promise<AllowedEmail | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    async create(data: Partial<AllowedEmail>): Promise<AllowedEmail> {
        return this.repo.save(this.repo.create(data));
    }

    async deleteById(id: number): Promise<void> {
        await this.repo.delete(id);
    }
}
