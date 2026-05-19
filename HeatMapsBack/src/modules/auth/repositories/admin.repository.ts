import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Admin } from '../../../models/Admin.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Contrato del repositorio de administradores.
 *
 * Los servicios dependen de esta interface, no de la clase concreta, para
 * permitir reemplazos en tests (mocks o repositorios en memoria).
 */
export interface IAdminRepository {
    /** Busca por hash de username o email (usado en login). */
    findByUsernameOrEmailHash(hash: string): Promise<Admin | null>;
    /** Busca por hash de email exacto. */
    findByEmailHash(emailHash: string): Promise<Admin | null>;
    /** Busca por hash de username exacto. */
    findByUsernameHash(usernameHash: string): Promise<Admin | null>;
    /** Persiste un nuevo administrador. */
    create(data: Partial<Admin>): Promise<Admin>;
}

/**
 * Implementación TypeORM del repositorio.
 *
 * Encapsula las queries y aisla al servicio de los detalles del ORM.
 * Si se quisiera cambiar a Prisma o a raw SQL, solo cambia este archivo.
 */
@injectable()
export class AdminRepository implements IAdminRepository {
    private readonly repo: Repository<Admin>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Admin);
    }

    findByUsernameOrEmailHash(hash: string): Promise<Admin | null> {
        return this.repo.findOne({
            where: [{ emailHash: hash }, { usernameHash: hash }],
        });
    }

    findByEmailHash(emailHash: string): Promise<Admin | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    findByUsernameHash(usernameHash: string): Promise<Admin | null> {
        return this.repo.findOne({ where: { usernameHash } });
    }

    async create(data: Partial<Admin>): Promise<Admin> {
        return this.repo.save(this.repo.create(data));
    }
}
