import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Configuración del transporte SMTP usado por `MailerService`.
 */
@singleton()
export class MailConfig {
    constructor(private readonly env: EnvService) {}

    get host(): string {
        return this.env.get('MAIL_HOST');
    }

    get port(): number {
        return this.env.get('MAIL_PORT');
    }

    get user(): string {
        return this.env.get('MAIL_USER');
    }

    get pass(): string {
        return this.env.get('MAIL_PASS');
    }

    get from(): string {
        return this.env.get('MAIL_FROM');
    }

    /** TLS implícito (true) o STARTTLS (false). Para Gmail puerto 587 → false. */
    get secure(): boolean {
        return this.port === 465;
    }
}
