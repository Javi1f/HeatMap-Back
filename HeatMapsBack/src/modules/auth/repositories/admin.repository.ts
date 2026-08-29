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
    /** Devuelve todos los administradores, del más antiguo al más reciente. */
    findAll(): Promise<Admin[]>;
}

/**
 * Implementación TypeORM del repositorio de administradores.
 *
 * Encapsula las queries y aisla al servicio de los detalles del ORM.
 * Si se quisiera cambiar a Prisma o a SQL crudo, solo cambia este archivo.
 */
@injectable()
export class AdminRepository implements IAdminRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Admin>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Admin);
    }

    /**
     * Busca un admin cuyo `emailHash` o `usernameHash` coincide con el hash
     * dado. Útil para el login, donde el usuario puede introducir indistintamente
     * su email o su username.
     */
    findByUsernameOrEmailHash(hash: string): Promise<Admin | null> {
        return this.repo.findOne({
            where: [{ emailHash: hash }, { usernameHash: hash }],
        });
    }

    /**
     * Busca un admin por el hash exacto de su email.
     */
    findByEmailHash(emailHash: string): Promise<Admin | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    /**
     * Busca un admin por el hash exacto de su username.
     */
    findByUsernameHash(usernameHash: string): Promise<Admin | null> {
        return this.repo.findOne({ where: { usernameHash } });
    }

    /**
     * Crea y persiste un nuevo administrador.
     *
     * @param data - Campos del admin (username/email/password ya cifrados/hasheados).
     * @returns La entidad persistida con sus columnas autogeneradas (id, fechas).
     */
    create(data: Partial<Admin>): Promise<Admin> {
        return this.repo.save(this.repo.create(data));
    }

    /**
     * Lista todos los administradores.
     *
     * Orden ascendente por id: el primer registrado es el fundador de la
     * instancia y conviene que encabece la tabla del panel.
     */
    findAll(): Promise<Admin[]> {
        return this.repo.find({ order: { id: 'ASC' } });
    }
}
