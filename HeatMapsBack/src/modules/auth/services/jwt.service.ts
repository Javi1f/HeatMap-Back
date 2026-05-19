import { injectable } from 'tsyringe';
import jwt, { SignOptions } from 'jsonwebtoken';
import { AppConfig } from '../../../config/app.config';
import { JwtPayload } from '../../../types/auth.types';
import { UnauthorizedError } from '../../../common/errors';

/**
 * Servicio dedicado al manejo de JWT.
 *
 * Aislar firma y verificación en un servicio propio permite:
 *  - Inyectarlo en el `authMiddleware` sin acoplar a `AuthService`.
 *  - Mockearlo trivialmente en tests.
 *  - Cambiar la librería (jose, paseto) tocando un solo archivo.
 */
@injectable()
export class JwtService {
    constructor(private readonly cfg: AppConfig) {}

    /**
     * Firma un token con la información mínima del administrador.
     */
    sign(payload: JwtPayload): string {
        const options: SignOptions = {
            expiresIn: this.cfg.auth.jwtExpiresIn as SignOptions['expiresIn'],
        };
        return jwt.sign(payload, this.cfg.auth.jwtSecret, options);
    }

    /**
     * Verifica y decodifica un token. Lanza {@link UnauthorizedError} si
     * el token es inválido o ha expirado.
     */
    verify(token: string): JwtPayload {
        try {
            return jwt.verify(token, this.cfg.auth.jwtSecret) as JwtPayload;
        } catch {
            throw new UnauthorizedError('Token inválido o expirado');
        }
    }
}
