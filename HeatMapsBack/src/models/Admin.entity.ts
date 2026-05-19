import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

/**
 * Administrador con acceso al panel.
 *
 * Diseño de seguridad:
 *  - `username` y `email` se almacenan **cifrados** (AES-256-GCM) en columnas
 *    `text`. Su valor en claro no se persiste nunca.
 *  - `usernameHash` y `emailHash` son **HMAC-SHA256** del valor normalizado
 *    (`lowercase().trim()`), permiten lookups O(1) por igualdad sin
 *    descifrar.
 *  - `password` es un hash bcrypt (cost 12). Nunca se descifra, solo se
 *    compara con `bcrypt.compare`.
 *
 * La entidad es deliberadamente **anémica** (solo schema): la lógica de
 * cifrado/descifrado vive en `DbFieldCipher` y la orquestación en
 * `AuthService`.
 */
@Entity('admins')
export class Admin {
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

    @Column({ type: 'text' })
    password: string;

    @Column({ default: false })
    isVerified: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
