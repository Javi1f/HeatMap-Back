import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn
} from 'typeorm';

@Entity('allowed_emails')
export class AllowedEmail {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    email: string;

    @Column({ unique: true, length: 64 })
    emailHash: string;

    @Column({ type: 'text', nullable: true })
    addedBy: string;

    @CreateDateColumn()
    createdAt: Date;
}
