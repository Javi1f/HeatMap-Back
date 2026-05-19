import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { PendingRegistration } from '../../../models/PendingRegistration.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Contrato del repositorio de registros pendientes de verificación por correo.
 */
export interface IPendingRegistrationRepository {
    /** Busca un pending por el hash determinista (HMAC) del email. */
    findByEmailHash(emailHash: string): Promise<PendingRegistration | null>;
    /** Elimina un pending por el hash de su email. Idempotente. */
    deleteByEmailHash(emailHash: string): Promise<void>;
    /** Elimina un pending por id. Idempotente. */
    deleteById(id: number): Promise<void>;
    /**
     * Incrementa el contador de intentos fallidos en una unidad sin lecturas
     * adicionales (recibe el `currentAttempts` ya conocido por el servicio).
     */
    incrementAttempts(id: number, currentAttempts: number): Promise<void>;
    /** Crea y persiste un nuevo registro pendiente. */
    create(data: Partial<PendingRegistration>): Promise<PendingRegistration>;
}

/**
 * Implementación TypeORM del repositorio de registros pendientes.
 *
 * Maneja el ciclo de vida del PendingRegistration: creación, búsqueda,
 * incremento de intentos y borrado por id o por hash de email.
 */
@injectable()
export class PendingRegistrationRepository implements IPendingRegistrationRepository {
    private readonly repo: Repository<PendingRegistration>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(PendingRegistration);
    }

    /**
     * Busca un pending por el hash determinista de su email.
     *
     * @returns El registro o `null` si no existe.
     */
    findByEmailHash(emailHash: string): Promise<PendingRegistration | null> {
        return this.repo.findOne({ where: { emailHash } });
    }

    /**
     * Borra todos los pending que coincidan con el hash de email dado.
     * Se usa antes de crear uno nuevo (limpia restos del flujo anterior)
     * y al cancelar la verificación.
     */
    async deleteByEmailHash(emailHash: string): Promise<void> {
        await this.repo.delete({ emailHash });
    }

    /**
     * Borra un pending por id (tras verificación exitosa, expiración o
     * agotamiento de intentos).
     */
    async deleteById(id: number): Promise<void> {
        await this.repo.delete({ id });
    }

    /**
     * Incrementa `attempts` en uno. El servicio le pasa el valor actual
     * para evitar un SELECT extra antes del UPDATE.
     */
    async incrementAttempts(id: number, currentAttempts: number): Promise<void> {
        await this.repo.update(id, { attempts: currentAttempts + 1 });
    }

    /**
     * Crea y persiste un nuevo registro pendiente.
     *
     * @param data - Campos del pending (username/email/code ya cifrados).
     * @returns La entidad persistida.
     */
    create(data: Partial<PendingRegistration>): Promise<PendingRegistration> {
        return this.repo.save(this.repo.create(data));
    }
}
