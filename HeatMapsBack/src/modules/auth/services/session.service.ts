import crypto from 'crypto';
import { injectable } from 'tsyringe';
import { SesionAuth } from '../../../models/SesionAuth.entity';
import { SesionAuthRepository } from '../repositories/sesion-auth.repository';
import { LoggerService } from '../../../common/logger/logger.service';

/**
 * Ciclo de vida de las sesiones de administrador.
 *
 * Convierte el esquema de JWT puro (donde `logout` no invalidaba nada y un
 * token filtrado seguía siendo válido hasta expirar) en uno con revocación
 * efectiva, sin renunciar a la verificación criptográfica del token.
 *
 * El token **nunca** se almacena: solo su SHA-256. Para revocar basta con
 * volver a hashear el token entrante y comparar, y quien lea la tabla no
 * obtiene credenciales utilizables.
 */
@injectable()
export class SessionService {
    constructor(
        private readonly repo: SesionAuthRepository,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Huella determinista de un token, usada como clave de la sesión.
     *
     * SHA-256 sin clave es suficiente aquí (a diferencia de las MAC): un JWT
     * tiene entropía de sobra, no es enumerable por fuerza bruta.
     */
    fingerprint(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Abre una sesión para un token recién emitido.
     *
     * @param expiresAt - Expiración del propio JWT, para que ambas coincidan.
     */
    async open(
        idAdmin: number,
        token: string,
        expiresAt: Date,
        ipOrigen: string | null,
    ): Promise<SesionAuth> {
        return this.repo.create({
            idAdmin,
            tokenHash: this.fingerprint(token),
            ipOrigen,
            fechaExpiracion: expiresAt,
            revocada: false,
        });
    }

    /**
     * Comprueba que el token corresponda a una sesión viva.
     *
     * Tolerancia deliberada: si el token no tiene fila asociada se considera
     * válido. Los tokens emitidos antes de que existiera esta tabla no tienen
     * sesión, y rechazarlos cerraría la sesión de todos los administradores en
     * el momento del despliegue. Las sesiones nuevas sí quedan registradas y
     * son revocables.
     */
    async isActive(token: string): Promise<boolean> {
        const sesion = await this.repo.findByTokenHash(this.fingerprint(token));
        if (!sesion) return true;
        return !sesion.revocada && sesion.fechaExpiracion.getTime() > Date.now();
    }

    /** Cierra la sesión asociada a un token concreto. */
    async closeByToken(token: string): Promise<void> {
        await this.repo.revokeByTokenHash(this.fingerprint(token));
    }

    /** Revoca una sesión por id. @returns `true` si estaba abierta. */
    async revoke(idSesion: string): Promise<boolean> {
        const revoked = await this.repo.revokeById(idSesion);
        if (revoked) this.logger.info(`Sesión ${idSesion} revocada`);
        return revoked;
    }

    /** Sesiones actualmente vivas. */
    listActive(): Promise<SesionAuth[]> {
        return this.repo.findActive();
    }

    /** Limpieza de sesiones caducadas. */
    purgeExpired(): Promise<number> {
        return this.repo.purgeExpired();
    }
}
