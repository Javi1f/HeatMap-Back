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
@Entity('allowed_emails')
export class AllowedEmail {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    email: string;

    @Index()
    @Column({ unique: true, length: 64 })
    emailHash: string;

    /** Username (cifrado) del admin que añadió este correo a la lista. */
    @Column({ type: 'text', nullable: true })
    addedBy: string;

    @CreateDateColumn()
    createdAt: Date;
}
