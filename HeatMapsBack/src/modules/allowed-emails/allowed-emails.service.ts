import { injectable } from 'tsyringe';
import { AllowedEmail } from '../../models/AllowedEmail.entity';
import { AllowedEmailRepository } from './repositories/allowed-email.repository';
import { DbFieldCipher } from '../../crypto/db-field.crypto';
import { ConflictError, NotFoundError } from '../../common/errors';

/**
 * Vista pública (descifrada) de un registro de correo permitido. La entidad
 * almacenada está cifrada; nunca la devolvemos directamente al exterior.
 */
export interface AllowedEmailView {
    id: number;
    email: string;
    addedBy: string | null;
    createdAt: Date;
}

/**
 * Servicio de gestión de la lista blanca de correos autorizados para registro.
 *
 * Responsabilidades:
 *  - CRUD sobre `AllowedEmail` con cifrado/descifrado transparente.
 *  - Verificar si un email está permitido (usado por `AuthService.register`).
 */
@injectable()
export class AllowedEmailsService {
    constructor(
        private readonly repo: AllowedEmailRepository,
        private readonly cipher: DbFieldCipher,
    ) {}

    /**
     * Lista todos los correos permitidos, descifrados, en orden descendente
     * por fecha de creación.
     */
    async getAll(): Promise<AllowedEmailView[]> {
        const records = await this.repo.findAll();
        return records.map((r) => this.toView(r));
    }

    /**
     * Añade un nuevo correo a la lista blanca.
     *
     * @throws {@link ConflictError} si el correo ya está registrado.
     */
    async add(email: string, addedBy: string): Promise<AllowedEmailView> {
        const emailHash = this.cipher.hash(email);
        const exists = await this.repo.findByEmailHash(emailHash);
        if (exists) throw new ConflictError('El correo ya está en la lista');

        const saved = await this.repo.create({
            email: this.cipher.encrypt(email),
            emailHash,
            addedBy: this.cipher.encrypt(addedBy),
        });
        return this.toView(saved);
    }

    /**
     * Elimina un correo permitido por id.
     *
     * @throws {@link NotFoundError} si no existe.
     */
    async remove(id: number): Promise<void> {
        const exists = await this.repo.findById(id);
        if (!exists) throw new NotFoundError('Correo no encontrado');
        await this.repo.deleteById(id);
    }

    /**
     * @returns `true` si el email está en la lista blanca.
     */
    async isAllowed(email: string): Promise<boolean> {
        const emailHash = this.cipher.hash(email);
        const found = await this.repo.findByEmailHash(emailHash);
        return !!found;
    }

    /**
     * Convierte la entidad cifrada en la vista pública descifrada.
     * No muta la entidad original (a diferencia de la implementación previa).
     */
    private toView(record: AllowedEmail): AllowedEmailView {
        return {
            id: record.id,
            email: this.cipher.decrypt(record.email),
            addedBy: record.addedBy ? this.cipher.decrypt(record.addedBy) : null,
            createdAt: record.createdAt,
        };
    }
}
