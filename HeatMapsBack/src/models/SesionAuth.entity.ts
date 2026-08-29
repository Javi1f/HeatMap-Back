import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Admin } from './Admin.entity';

/**
 * Sesión abierta por un administrador.
 *
 * Existe para cerrar un agujero del esquema puramente stateless que había
 * antes: al ser el JWT autocontenido, `POST /logout` no invalidaba nada y un
 * token robado seguía siendo válido hasta su expiración. Con esta tabla, el
 * `authMiddleware` comprueba en cada petición que la sesión del token siga
 * viva, y cerrar sesión (propia o ajena) tiene efecto inmediato.
 *
 * Se guarda `tokenHash` (SHA-256 del JWT), nunca el token: quien lea la tabla
 * no debe poder suplantar al usuario.
 */
@Entity('sesion_auth')
export class SesionAuth {
    /** Identificador de la sesion, usado para revocarla desde el panel. */
    @PrimaryGeneratedColumn('uuid', { name: 'id_sesion' })
    idSesion: string;

    /** Cuenta titular de la sesion. */
    @Index()
    @Column({ name: 'id_admin', type: 'int' })
    idAdmin: number;

    /** Titular asociado. Borrar la cuenta cierra todas sus sesiones. */
    @ManyToOne(() => Admin, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'id_admin' })
    admin: Admin;

    /**
     * SHA-256 hex del JWT emitido. Permite revocar sin almacenar el token.
     *
     * La unicidad se declara solo en `@Column`, por el mismo motivo que en
     * `Zona.nombre`: duplicar la declaración rompe la sincronización.
     */
    @Column({ name: 'token_hash', length: 64, unique: true })
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

    /** Momento del inicio de sesion. */
    @CreateDateColumn({ name: 'fecha_inicio' })
    fechaInicio: Date;

    /** Copia de la expiracion del JWT, para poder purgar sin decodificarlo. */
    @Index()
    @Column({ name: 'fecha_expiracion', type: 'datetime' })
    fechaExpiracion: Date;

    /** `true` tras un logout o una revocacion desde el panel. */
    @Column({ name: 'revocada', default: false })
    revocada: boolean;
}
