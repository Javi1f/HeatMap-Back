import {
    Entity, PrimaryGeneratedColumn, Column,
    CreateDateColumn, UpdateDateColumn
} from 'typeorm';

@Entity('admins')
export class Admin {
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

    @Column({ default: false })
    isVerified: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
