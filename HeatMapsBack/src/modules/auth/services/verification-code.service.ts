import { injectable } from 'tsyringe';
import { AppConfig } from '../../../config/app.config';
import { generateNumericCode } from '../../../common/utils/random';

/**
 * Genera códigos de verificación criptográficamente seguros y calcula su
 * fecha de expiración a partir de la configuración global.
 */
@injectable()
export class VerificationCodeService {
    /** Longitud fija del código numérico. */
    private readonly digits = 5;

    constructor(private readonly cfg: AppConfig) {}

    /** Genera un nuevo código de 5 dígitos. */
    generate(): string {
        return generateNumericCode(this.digits);
    }

    /** @returns Fecha futura en la que el código caducará. */
    expiryDate(): Date {
        const minutes = this.cfg.auth.verificationCodeExpiresMinutes;
        return new Date(Date.now() + minutes * 60_000);
    }

    /** Máximo de intentos antes de invalidar el registro pendiente. */
    get maxAttempts(): number {
        return this.cfg.auth.maxVerificationAttempts;
    }
}
