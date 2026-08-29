import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Configuración del transporte SMTP usado por `MailerService`.
 */
@singleton()
export class MailConfig {
    constructor(private readonly env: EnvService) {}

    /** Host del servidor SMTP. */
    get host(): string {
        return this.env.get('MAIL_HOST');
    }

    /** Puerto del servidor SMTP. */
    get port(): number {
        return this.env.get('MAIL_PORT');
    }

    /** Usuario de autenticacion SMTP. */
    get user(): string {
        return this.env.get('MAIL_USER');
    }

    /** Contrasena de autenticacion SMTP. */
    get pass(): string {
        return this.env.get('MAIL_PASS');
    }

    /** Direccion que figura como remitente. */
    get from(): string {
        return this.env.get('MAIL_FROM');
    }

    /** TLS implícito (true) o STARTTLS (false). Para Gmail puerto 587 → false. */
    get secure(): boolean {
        return this.port === 465;
    }
}
