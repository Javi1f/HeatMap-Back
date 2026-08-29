import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Registro de admin pendiente de verificación por correo.
 *
 * Vida útil: se crea cuando un admin invoca `POST /register` con un email
 * autorizado, y se elimina cuando:
 *  - El admin verifica con éxito (se promueve a `Admin`).
 *  - El código expira (`expiresAt < now`).
 *  - Se exceden `MAX_VERIFICATION_ATTEMPTS` intentos.
 *  - El admin cancela explícitamente.
 *
 * Diseño de seguridad: mismo patrón que `Admin` (campos cifrados + hash
 * indexable). El código de verificación también se cifra para no exponerlo
 * en backups o logs de queries.
 */
@Entity('registro_pendiente')
export class PendingRegistration {
    /** Clave primaria autonumerica. */
    @PrimaryGeneratedColumn({ name: 'id_registro' })
    id: number;

    /** Nombre de usuario cifrado con AES-256-GCM. */
    @Column({ name: 'username', type: 'text' })
    username: string;

    /** HMAC del username normalizado, para buscar sin descifrar. */
    /*
     * Sin `@Index()`: una columna `unique` ya trae su propio índice. Declarar
     * ambos hace que TypeORM emita dos índices con el mismo nombre generado
     * —uno normal y otro único— y MySQL rechaza el CREATE TABLE con
     * «Duplicate key name».
     */
    @Column({ name: 'username_hash', unique: true, length: 64 })
    usernameHash: string;

    /** Correo cifrado con AES-256-GCM. */
    @Column({ name: 'email', type: 'text' })
    email: string;

    /** HMAC del correo normalizado, para buscar sin descifrar. */
    /*
     * Sin `@Index()`: una columna `unique` ya trae su propio índice. Declarar
     * ambos hace que TypeORM emita dos índices con el mismo nombre generado
     * —uno normal y otro único— y MySQL rechaza el CREATE TABLE con
     * «Duplicate key name».
     */
    @Column({ name: 'email_hash', unique: true, length: 64 })
    emailHash: string;

    /** Password ya hasheado con bcrypt (no se cifra: bcrypt ya es no reversible). */
    @Column({ name: 'password_hash', type: 'text' })
    password: string;

    /** Código de verificación cifrado con AES-256-GCM. */
    @Column({ name: 'codigo', type: 'text' })
    code: string;

    /** Caducidad del codigo. Indexado para poder purgar los vencidos. */
    @Index()
    @Column({ name: 'fecha_expiracion' })
    expiresAt: Date;

    /** Intentos de verificacion consumidos. */
    @Column({ name: 'intentos', default: 0 })
    attempts: number;

    /** Inicio del flujo de registro. */
    @CreateDateColumn({ name: 'fecha_creacion' })
    createdAt: Date;
}
