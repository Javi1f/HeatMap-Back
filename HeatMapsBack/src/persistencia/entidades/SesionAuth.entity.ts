import {
    BeforeInsert,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    Unique,
} from 'typeorm';
import { Admin } from './Admin.entity';
import { COLUMNA_UUID, nuevoUuid } from './uuid';

/**
 * Sesión abierta por un administrador (entidad SESION_AUTH del Anexo 13).
 *
 * Existe para cerrar un agujero del esquema puramente stateless: al ser el JWT
 * autocontenido, `POST /logout` no invalidaba nada y un token robado seguía
 * siendo válido hasta su expiración. Con esta tabla, el `authMiddleware`
 * comprueba en cada petición que la sesión del token siga viva, y cerrar
 * sesión (propia o ajena) tiene efecto inmediato.
 *
 * Se guarda `tokenHash` (SHA-256 del JWT), nunca el token: quien lea la tabla
 * no debe poder suplantar al usuario.
 */
@Entity('sesion_auth')
@Unique('uq_sesion_auth_token_hash', ['tokenHash'])
@Index('idx_sesion_auth_admin', ['idAdmin'])
@Index('idx_sesion_auth_expiracion', ['fechaExpiracion'])
export class SesionAuth {
    /** Identificador de la sesión, usado para revocarla desde el panel. */
    @PrimaryColumn({ name: 'id_sesion', ...COLUMNA_UUID })
    idSesion: string;

    /** Cuenta titular de la sesión. */
    @Column({ name: 'id_admin', ...COLUMNA_UUID })
    idAdmin: string;

    /** Titular asociado. Borrar la cuenta cierra todas sus sesiones. */
    @ManyToOne(() => Admin, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'id_admin', foreignKeyConstraintName: 'fk_sesion_auth_admin' })
    admin: Admin;

    /** SHA-256 hex del JWT emitido. Permite revocar sin almacenar el token. */
    @Column({ name: 'token_hash', type: 'char', length: 64 })
    tokenHash: string;

    /**
     * IP desde la que se inició sesión, para auditoría.
     *
     * El tipo de columna se declara explícitamente porque TypeORM no puede
     * inferirlo de una unión `string | null`: los metadatos de diseño la
     * reducen a `Object` y el driver de MySQL la rechaza al arrancar.
     */
    @Column({ name: 'ip_origen', type: 'varchar', length: 45, nullable: true })
    ipOrigen: string | null;

    /** Momento del inicio de sesión. */
    @CreateDateColumn({ name: 'fecha_inicio', type: 'datetime', precision: 6 })
    fechaInicio: Date;

    /** Copia de la expiración del JWT, para poder purgar sin decodificarlo. */
    @Column({ name: 'fecha_expiracion', type: 'datetime' })
    fechaExpiracion: Date;

    /** `true` tras un logout o una revocación desde el panel. */
    @Column({ name: 'revocada', type: 'boolean', default: false })
    revocada: boolean;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.idSesion ??= nuevoUuid();
    }
}
