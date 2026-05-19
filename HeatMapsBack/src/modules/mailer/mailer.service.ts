import { singleton } from 'tsyringe';
import nodemailer, { Transporter } from 'nodemailer';
import { MailConfig } from '../../config/mail.config';
import { AppConfig } from '../../config/app.config';
import { LoggerService } from '../../common/logger/logger.service';

/**
 * Contrato del servicio de envío de correos. Los servicios de negocio
 * dependen de esta interface, no de la clase concreta, para permitir
 * mocks en tests (ej. evitar enviar correos reales).
 */
export interface IMailerService {
    sendVerificationCode(to: string, code: string): Promise<void>;
}

/**
 * Implementación basada en `nodemailer` SMTP.
 *
 * Encapsula:
 *  - Configuración del transporter (lazy: se crea en el constructor).
 *  - Templates HTML.
 *  - Logging de envíos y fallos.
 */
@singleton()
export class MailerService implements IMailerService {
    private readonly transporter: Transporter;

    constructor(
        private readonly mailCfg: MailConfig,
        private readonly appCfg: AppConfig,
        private readonly logger: LoggerService,
    ) {
        this.transporter = nodemailer.createTransport({
            host: mailCfg.host,
            port: mailCfg.port,
            secure: mailCfg.secure,
            auth: { user: mailCfg.user, pass: mailCfg.pass },
        });
    }

    /**
     * Envía un correo con el código de verificación para registro.
     *
     * @throws Error si el SMTP falla. El llamador decide si propaga o tolera.
     */
    async sendVerificationCode(to: string, code: string): Promise<void> {
        const minutes = this.appCfg.auth.verificationCodeExpiresMinutes;
        const maxAttempts = this.appCfg.auth.maxVerificationAttempts;

        try {
            await this.transporter.sendMail({
                from: `"HeatMaps" <${this.mailCfg.from}>`,
                to,
                subject: 'Código de verificación',
                html: this.buildVerificationHtml(code, minutes, maxAttempts),
            });
            this.logger.info(`Código de verificación enviado a ${to}`);
        } catch (err) {
            this.logger.error(`Fallo enviando correo de verificación a ${to}`, err);
            throw err;
        }
    }

    /**
     * Construye el HTML del correo de verificación.
     *
     * Mantener el template aquí (en lugar de cadenas en otros archivos)
     * facilita migrarlo a un motor de templates (Handlebars, MJML).
     */
    private buildVerificationHtml(code: string, minutes: number, maxAttempts: number): string {
        return `
            <h2>Verificación de cuenta</h2>
            <p>Tu código de verificación es:</p>
            <h1 style="letter-spacing: 8px;">${code}</h1>
            <p>Este código expira en ${minutes} minutos.</p>
            <p>Tienes ${maxAttempts} intentos. Si no solicitaste este registro, ignora este correo.</p>
        `.trim();
    }
}
