import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

/** Rol de una cuenta administrativa. */
export type RolAdmin = 'root' | 'admin';

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
 * Los nombres de columna se declaran de forma explícita para que la base de
 * datos siga el modelo relacional del Anexo 13 (`snake_case` en español) sin
 * arrastrar esa convención al código TypeScript, que mantiene `camelCase`.
 *
 * La entidad es deliberadamente **anémica** (solo schema): la lógica de
 * cifrado/descifrado vive en `DbFieldCipher` y la orquestación en
 * `AuthService`.
 */
@Entity('admin')
export class Admin {
    /**
     * Clave primaria autonumérica.
     *
     * El modelo la dibuja como UUID; se conserva como entero porque el sistema
     * ya está en explotación con cuentas y sesiones que la referencian, y
     * migrarla no aportaría nada funcional.
     */
    @PrimaryGeneratedColumn({ name: 'id_admin' })
    id: number;

    /** Nombre de usuario cifrado con AES-256-GCM. */
    @Column({ name: 'username', type: 'text' })
    username: string;

    /** HMAC del username normalizado, para buscar sin descifrar. */
    @Index()
    @Column({ name: 'username_hash', unique: true, length: 64 })
    usernameHash: string;

    /** Correo cifrado con AES-256-GCM. */
    @Column({ name: 'email', type: 'text' })
    email: string;

    /** HMAC del correo normalizado, para buscar sin descifrar. */
    @Index()
    @Column({ name: 'email_hash', unique: true, length: 64 })
    emailHash: string;

    /** Hash bcrypt de la contraseña. Nunca se descifra, solo se compara. */
    @Column({ name: 'password_hash', type: 'text' })
    password: string;

    /**
     * `root` es la cuenta semilla de la instancia, que no puede desactivarse ni
     * eliminarse: sin ella el sistema podría quedarse sin ningún acceso
     * administrativo.
     */
    @Column({ name: 'rol', type: 'enum', enum: ['root', 'admin'], default: 'admin' })
    rol: RolAdmin;

    /**
     * Semilla TOTP para el segundo factor por aplicación.
     *
     * Reservada: el flujo actual verifica con un código enviado por correo, no
     * con TOTP, así que hoy siempre es `null`.
     */
    @Column({ name: 'mfa_secret', type: 'varchar', length: 255, nullable: true })
    mfaSecret: string | null;

    /** `true` cuando la cuenta completó la verificación por correo. */
    @Column({ name: 'verificado', default: false })
    isVerified: boolean;

    /** `false` inhabilita el acceso conservando el historial de la cuenta. */
    @Column({ name: 'activo', default: true })
    activo: boolean;

    /** Momento del último inicio de sesión correcto. */
    @Column({ name: 'ultimo_acceso', type: 'datetime', nullable: true })
    ultimoAcceso: Date | null;

    /** Alta de la cuenta. */
    @CreateDateColumn({ name: 'fecha_creacion' })
    createdAt: Date;

    /** Última modificación de la fila. */
    @UpdateDateColumn({ name: 'fecha_actualizacion' })
    updatedAt: Date;
}
