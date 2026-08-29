import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Configuración general de la aplicación.
 *
 * Expone valores derivados del entorno con nombres semánticos y agrupados
 * por dominio. Sirve como capa de indirección entre `EnvService` (raw env)
 * y los consumidores (services), evitando que cada servicio sepa de qué
 * variable concreta viene cada cosa.
 */
@singleton()
export class AppConfig {
    constructor(private readonly env: EnvService) {}

    /** Puerto HTTP donde escucha el servidor. */
    get port(): number {
        return this.env.get('PORT');
    }

    /** Origen permitido para CORS (`*` por defecto). */
    get corsOrigin(): string {
        return this.env.get('CORS_ORIGIN');
    }

    /** Saltos de proxy en los que confiar para deducir la IP del cliente. */
    get trustProxy(): number {
        return this.env.get('TRUST_PROXY');
    }

    /** Configuración del subsistema de autenticación. */
    get auth(): {
        jwtSecret: string;
        jwtExpiresIn: string;
        maxVerificationAttempts: number;
        verificationCodeExpiresMinutes: number;
    } {
        return {
            jwtSecret: this.env.get('JWT_SECRET'),
            jwtExpiresIn: this.env.get('JWT_EXPIRES_IN'),
            maxVerificationAttempts: this.env.get('MAX_VERIFICATION_ATTEMPTS'),
            verificationCodeExpiresMinutes: this.env.get('VERIFICATION_CODE_EXPIRES_MINUTES'),
        };
    }
}
