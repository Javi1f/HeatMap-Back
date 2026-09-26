import {
    BeforeInsert,
    Column,
    CreateDateColumn,
    Entity,
    PrimaryColumn,
    Unique,
    UpdateDateColumn,
} from 'typeorm';
import { COLUMNA_UUID, nuevoUuid } from './uuid';

/** Rol de una cuenta administrativa. */
export type RolAdmin = 'root' | 'admin';

/**
 * Administrador con acceso al panel (entidad ADMIN del Anexo 13).
 *
 * Diseño de seguridad:
 *  - `username` y `email` se almacenan **cifrados** (AES-256-GCM) en columnas
 *    `text`. Su valor en claro no se persiste nunca (RNF-13).
 *  - `usernameHash` y `emailHash` son **HMAC-SHA256** del valor normalizado
 *    (`lowercase().trim()`), permiten lookups O(1) por igualdad sin
 *    descifrar, y son los que llevan la unicidad.
 *  - `password` es un hash bcrypt (cost 12). Nunca se descifra, solo se
 *    compara con `bcrypt.compare`.
 *
 * Los nombres de columna, índices y restricciones son los de `bd/database.sql`,
 * que es la fuente del esquema; `npm run bd:deriva` comprueba que coinciden.
 *
 * La entidad es deliberadamente **anémica** (solo schema): la lógica de
 * cifrado/descifrado vive en `DbFieldCipher` y la orquestación en
 * `AuthService`.
 */
@Entity('admin')
@Unique('uq_admin_username_hash', ['usernameHash'])
@Unique('uq_admin_email_hash', ['emailHash'])
export class Admin {
    /** Identificador UUID de la cuenta. */
    @PrimaryColumn({ name: 'id_admin', ...COLUMNA_UUID })
    id: string;

    /** Nombre de usuario cifrado con AES-256-GCM. */
    @Column({ name: 'username', type: 'text' })
    username: string;

    /** HMAC del username normalizado, para buscar sin descifrar. */
    @Column({ name: 'username_hash', type: 'char', length: 64 })
    usernameHash: string;

    /** Correo cifrado con AES-256-GCM. */
    @Column({ name: 'email', type: 'text' })
    email: string;

    /** HMAC del correo normalizado, para buscar sin descifrar. */
    @Column({ name: 'email_hash', type: 'char', length: 64 })
    emailHash: string;

    /** Hash bcrypt de la contraseña. Nunca se descifra, solo se compara. */
    @Column({ name: 'password_hash', type: 'text' })
    password: string;

    /**
     * `root` administra cuentas y correos; `admin`, solo datos. Al menos una
     * cuenta root activa debe existir siempre (ver `reglas-roles.ts`).
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
    @Column({ name: 'verificado', type: 'boolean', default: false })
    isVerified: boolean;

    /** `false` inhabilita el acceso conservando el historial de la cuenta. */
    @Column({ name: 'activo', type: 'boolean', default: true })
    activo: boolean;

    /** Momento del último inicio de sesión correcto. */
    @Column({ name: 'ultimo_acceso', type: 'datetime', nullable: true })
    ultimoAcceso: Date | null;

    /** Alta de la cuenta. */
    @CreateDateColumn({ name: 'fecha_creacion', type: 'datetime', precision: 6 })
    createdAt: Date;

    /** Última modificación de la fila. */
    @UpdateDateColumn({ name: 'fecha_actualizacion', type: 'datetime', precision: 6 })
    updatedAt: Date;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.id ??= nuevoUuid();
    }
}
