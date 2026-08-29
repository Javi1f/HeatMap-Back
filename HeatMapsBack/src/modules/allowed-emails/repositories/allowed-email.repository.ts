import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { AllowedEmail } from '../../../models/AllowedEmail.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Contrato del repositorio de correos permitidos para registro.
 *
 * Los servicios dependen de esta interface, no de la clase concreta, para
 * permitir reemplazos en tests (mocks o repositorios en memoria).
 */
export interface IAllowedEmailRepository {
    /** Devuelve todos los correos permitidos (orden descendente por fecha). */
    findAll(): Promise<AllowedEmail[]>;
    /** Busca un correo permitido por id. */
    findById(id: number): Promise<AllowedEmail | null>;
    /** Busca por hash determinista (HMAC) del email. */
    findByEmailHash(emailHash: string): Promise<AllowedEmail | null>;
    /** Persiste un nuevo correo permitido. */
    create(data: Partial<AllowedEmail>): Promise<AllowedEmail>;
    /** Elimina un correo permitido por id. */
    deleteById(id: number): Promise<void>;
}

/**
 * Implementación TypeORM del repositorio de correos permitidos.
 *
 * Encapsula las queries y aisla al servicio de los detalles del ORM.
 * Si se quisiera cambiar a Prisma o a SQL crudo, solo cambia este archivo.
 */
@injectable()
export class AllowedEmailRepository implements IAllowedEmailRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<AllowedEmail>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(AllowedEmail);
    }

    /**
     * Lista todos los correos permitidos.
     *
     * @returns Registros ordenados por `createdAt` descendente.
     */
    findAll(): Promise<AllowedEmail[]> {
        return this.repo.find({ order: { createdAt: 'DESC' } });
    }

    /**
     * Busca un registro por su id.
     *
     * @returns El registro o `null` si no existe.
     */
    findById(id: number): Promise<AllowedEmail | null> {
        return this.repo.findOne({ where: { id } });
    }

    /**
     * Busca un registro por el hash determinista (HMAC) del email.
     *
     * @returns El registro o `null` si no existe.
     */
    findByEmailHash(emailHash: string): Promise<AllowedEmail | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    /**
     * Crea y persiste un nuevo registro.
     *
     * @param data - Campos del registro (email y emailHash ya cifrados/hasheados).
     * @returns La entidad recién persistida con sus columnas autogeneradas.
     */
    create(data: Partial<AllowedEmail>): Promise<AllowedEmail> {
        return this.repo.save(this.repo.create(data));
    }

    /**
     * Elimina un registro por id. Idempotente: no falla si no existe.
     */
    async deleteById(id: number): Promise<void> {
        await this.repo.delete(id);
    }
}
