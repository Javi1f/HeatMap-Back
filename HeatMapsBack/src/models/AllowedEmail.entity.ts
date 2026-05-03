import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn
} from 'typeorm';

@Entity('allowed_emails')
export class AllowedEmail {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true, length: 150 })
    email: string;

    @Column({ length: 100, nullable: true })
    addedBy: string;

    @CreateDateColumn()
    createdAt: Date;
}