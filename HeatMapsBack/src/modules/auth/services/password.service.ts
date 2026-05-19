import { injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';

/**
 * Hashing y verificación de contraseñas con bcrypt.
 *
 * Encapsular bcrypt en un servicio permite cambiar a argon2 o scrypt
 * sin tocar el resto del sistema.
 */
@injectable()
export class PasswordService {
    private readonly rounds = 12;

    /**
     * Genera un hash bcrypt de la contraseña en texto plano.
     */
    hash(plain: string): Promise<string> {
        return bcrypt.hash(plain, this.rounds);
    }

    /**
     * Compara una contraseña en texto plano contra su hash almacenado.
     */
    verify(plain: string, hashed: string): Promise<boolean> {
        return bcrypt.compare(plain, hashed);
    }
}
