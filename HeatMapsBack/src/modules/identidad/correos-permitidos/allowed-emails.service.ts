import { injectable } from 'tsyringe';
import { AllowedEmail } from '../../../persistencia/entidades/AllowedEmail.entity';
import { AllowedEmailRepository } from '../../../persistencia/repositorios/allowed-email.repository';
import { DbFieldCipher } from '../../../crypto/db-field.crypto';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../common/errors';

/**
 * Vista pública (descifrada) de un registro de correo permitido. La entidad
 * almacenada está cifrada; nunca la devolvemos directamente al exterior.
 */
export interface AllowedEmailView {
    /** Identificador UUID del registro. */
    id: string;

    /** Correo autorizado, ya descifrado. */
    email: string;

    /** Nombre del administrador que lo autorizó, o `null` si no consta (el fundador). */
    addedBy: string | null;

    /** Momento en que se autorizó. */
    createdAt: Date;

    /** `true` en el correo del administrador raíz, que nadie puede eliminar. */
    esFundador: boolean;
}

/** Administrador que hace la petición, tal como viaja en su token. */
export interface Solicitante {
    id: string;
    username: string;
    email: string;
}

/**
 * Servicio de gestión de la lista blanca de correos autorizados para registro.
 *
 * Responsabilidades:
 *  - CRUD sobre `AllowedEmail` con cifrado/descifrado transparente.
 *  - Verificar si un email está permitido (usado por `AuthService.register`).
 *  - Proteger los correos que no pueden eliminarse: el del fundador (el
 *    administrador raíz, sección 6.11 del documento) y el propio. La regla se
 *    aplica aquí, en el servidor; el panel solo la refleja deshabilitando el
 *    botón, y una petición hecha a mano recibe el mismo rechazo.
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
        return records.map((registro) => this.toView(registro, registro.autor?.username ?? null));
    }

    /**
     * Añade un nuevo correo a la lista blanca, a nombre de quien lo pide.
     *
     * @throws {@link ConflictError} si el correo ya está registrado.
     */
    async add(email: string, solicitante: Solicitante): Promise<AllowedEmailView> {
        const emailHash = this.cipher.hash(email);
        const exists = await this.repo.findByEmailHash(emailHash);
        if (exists) throw new ConflictError('El correo ya está en la lista');

        const saved = await this.repo.create({
            email: this.cipher.encrypt(email),
            emailHash,
            anadidoPor: solicitante.id,
            esFundador: false,
        });
        return this.toView(saved, this.cipher.encrypt(solicitante.username));
    }

    /**
     * Elimina un correo permitido por id.
     *
     * @throws {@link NotFoundError}  si no existe.
     * @throws {@link ForbiddenError} si es el correo fundador o el de quien lo pide.
     */
    async remove(id: string, solicitante: Solicitante): Promise<void> {
        const registro = await this.repo.findById(id);
        if (!registro) throw new NotFoundError('Correo no encontrado');
        if (registro.esFundador) throw new ForbiddenError('No se puede eliminar el correo fundador');
        if (registro.emailHash === this.cipher.hash(solicitante.email)) {
            throw new ForbiddenError('No puedes eliminar tu propio correo');
        }
        await this.repo.deleteById(id);
    }

    /**
     * @returns `true` si el email está en la lista blanca.
     */
    async isAllowed(email: string): Promise<boolean> {
        const emailHash = this.cipher.hash(email);
        const found = await this.repo.findByEmailHash(emailHash);
        return found !== null;
    }

    /**
     * Convierte la entidad cifrada en la vista pública descifrada.
     *
     * @param autorCifrado - Username cifrado de quien lo autorizó, si consta.
     */
    private toView(record: AllowedEmail, autorCifrado: string | null): AllowedEmailView {
        return {
            id: record.id,
            email: this.cipher.decrypt(record.email),
            addedBy: autorCifrado ? this.cipher.decrypt(autorCifrado) : null,
            createdAt: record.createdAt,
            esFundador: record.esFundador,
        };
    }
}
