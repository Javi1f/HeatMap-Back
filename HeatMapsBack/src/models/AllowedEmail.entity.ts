import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Correo autorizado para iniciar el flujo de registro.
 *
 * El admin que crea un nuevo registro debe tener su email en esta tabla
 * (lookup en `AuthService.register` → `AllowedEmailsService.isAllowed`).
 *
 * - `email` y `addedBy` cifrados (AES-256-GCM).
 * - `emailHash` HMAC-SHA256 para búsqueda determinista.
 */
@Entity('correo_permitido')
export class AllowedEmail {
    /** Clave primaria autonumerica. */
    @PrimaryGeneratedColumn({ name: 'id_correo' })
    id: number;

    /** Correo autorizado, cifrado con AES-256-GCM. */
    @Column({ name: 'email', type: 'text' })
    email: string;

    /** HMAC del correo normalizado, para comprobar pertenencia sin descifrar. */
    @Index()
    @Column({ name: 'email_hash', unique: true, length: 64 })
    emailHash: string;

    /** Username (cifrado) del admin que añadió este correo a la lista. */
    @Column({ name: 'anadido_por', type: 'text', nullable: true })
    addedBy: string;

    /** Momento en que se autorizo el correo. */
    @CreateDateColumn({ name: 'fecha_anadido' })
    createdAt: Date;
}
