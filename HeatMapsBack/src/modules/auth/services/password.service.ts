import { injectable } from 'tsyringe';
import bcrypt from 'bcryptjs';

/**
 * Tipo del módulo `bcryptjs` reducido a las operaciones que usamos.
 * Permite sustituirlo por un mock en tests si se quisiera.
 */
type BcryptLike = Pick<typeof bcrypt, 'hash' | 'compare'>;

/**
 * Hashing y verificación de contraseñas con bcrypt.
 *
 * Encapsular bcrypt en un servicio permite cambiar a argon2 o scrypt
 * sin tocar el resto del sistema.
 *
 * La referencia a la librería se guarda como **propiedad de instancia**
 * (`this.bcrypt`) para que tanto `hash` como `verify` la consuman vía
 * `this`, manteniendo coherencia y facilitando inyectar un doble en tests.
 */
@injectable()
export class PasswordService {
    private readonly rounds = 12;
    private readonly bcrypt: BcryptLike = bcrypt;

    /**
     * Genera un hash bcrypt de la contraseña en texto plano.
     */
    hash(plain: string): Promise<string> {
        return this.bcrypt.hash(plain, this.rounds);
    }

    /**
     * Compara una contraseña en texto plano contra su hash almacenado.
     */
    verify(plain: string, hashed: string): Promise<boolean> {
        return this.bcrypt.compare(plain, hashed);
    }
}
