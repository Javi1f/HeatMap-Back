import { injectable } from 'tsyringe';
import jwt, { SignOptions } from 'jsonwebtoken';
import { AppConfig } from '../../../config/app.config';
import { JwtPayload } from '../../../types/auth.types';
import { UnauthorizedError } from '../../../common/errors';

/**
 * Momento de expiración de un token ya firmado.
 *
 * Se lee del propio token en lugar de recalcularlo a partir de
 * `jwtExpiresIn`: así la fila de sesión y el JWT no pueden divergir aunque
 * se cambie el formato de la configuración ("24h", "1d", segundos…).
 *
 * @returns La fecha de expiración, o `null` si el token no declara `exp`.
 */
const expiryOf = (token: string): Date | null => {
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object' || typeof decoded.exp !== 'number') {
        return null;
    }
    return new Date(decoded.exp * 1000);
};

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
    /** Fecha de expiración declarada por el token, o `null` si no la declara. */
    readonly expiryOf = expiryOf;

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
