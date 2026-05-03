import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn
} from 'typeorm';

@Entity('pending_registrations')
export class PendingRegistration {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true, length: 50 })
    username: string;

    @Column({ unique: true, length: 150 })
    email: string;

    @Column()
    password: string;

    @Column({ length: 10 })
    code: string;

    @Column()
    expiresAt: Date;

    @Column({ default: 0 })
    attempts: number;

    @CreateDateColumn()
    createdAt: Date;
}