import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn
} from 'typeorm';

@Entity('pending_registrations')
export class PendingRegistration {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'text' })
    username: string;

    @Column({ unique: true, length: 64 })
    usernameHash: string;

    @Column({ type: 'text' })
    email: string;

    @Column({ unique: true, length: 64 })
    emailHash: string;

    @Column({ type: 'text' })
    password: string;

    @Column({ type: 'text' })
    code: string;

    @Column()
    expiresAt: Date;

    @Column({ default: 0 })
    attempts: number;

    @CreateDateColumn()
    createdAt: Date;
}
