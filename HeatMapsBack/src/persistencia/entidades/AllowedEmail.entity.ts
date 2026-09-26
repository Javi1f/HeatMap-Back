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
 * Correo autorizado para iniciar el flujo de registro (entidad
 * CORREO_PERMITIDO del Anexo 13).
 *
 * Quien se registra como administrador debe tener su correo en esta tabla
 * (`AuthService.register` → `AllowedEmailsService.isAllowed`).
 *
 * - `email` cifrado (AES-256-GCM) y `emailHash` HMAC-SHA256 para buscar.
 * - `anadidoPor` referencia al administrador que lo autorizó.
 * - `esFundador` marca el correo del administrador raíz, que no puede
 *   eliminarse (sección 6.11 del documento).
 */
@Entity('correo_permitido')
@Unique('uq_correo_permitido_hash', ['emailHash'])
@Index('idx_correo_permitido_anadido_por', ['anadidoPor'])
export class AllowedEmail {
    /** Identificador UUID del correo autorizado. */
    @PrimaryColumn({ name: 'id_correo', ...COLUMNA_UUID })
    id: string;

    /** Correo autorizado, cifrado con AES-256-GCM. */
    @Column({ name: 'email', type: 'text' })
    email: string;

    /** HMAC del correo normalizado, para comprobar pertenencia sin descifrar. */
    @Column({ name: 'email_hash', type: 'char', length: 64 })
    emailHash: string;

    /**
     * Administrador que autorizó el correo. `null` en el fundador, que se da de
     * alta al instalar, antes de que exista ninguna cuenta.
     */
    @Column({ name: 'anadido_por', ...COLUMNA_UUID, nullable: true })
    anadidoPor: string | null;

    /** Autor asociado. Si se borra la cuenta, el correo queda sin autor. */
    @ManyToOne(() => Admin, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'anadido_por', foreignKeyConstraintName: 'fk_correo_permitido_admin' })
    autor: Admin | null;

    /** Momento en que se autorizó el correo. */
    @CreateDateColumn({ name: 'fecha_anadido', type: 'datetime', precision: 6 })
    createdAt: Date;

    /** `true` en el correo del administrador raíz. Nadie puede eliminarlo. */
    @Column({ name: 'es_fundador', type: 'boolean', default: false })
    esFundador: boolean;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.id ??= nuevoUuid();
    }
}
