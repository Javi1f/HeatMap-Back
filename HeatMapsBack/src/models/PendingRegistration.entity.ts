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
@Entity('pending_registrations')
export class PendingRegistration {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    username: string;

    @Index()
    @Column({ unique: true, length: 64 })
    usernameHash: string;

    @Column({ type: 'text' })
    email: string;

    @Index()
    @Column({ unique: true, length: 64 })
    emailHash: string;

    /** Password ya hasheado con bcrypt (no se cifra: bcrypt ya es no reversible). */
    @Column({ type: 'text' })
    password: string;

    /** Código de verificación cifrado con AES-256-GCM. */
    @Column({ type: 'text' })
    code: string;

    @Index()
    @Column()
    expiresAt: Date;

    @Column({ default: 0 })
    attempts: number;

    @CreateDateColumn()
    createdAt: Date;
}
