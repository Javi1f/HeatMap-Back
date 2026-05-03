import { AppDataSource } from '../../config/database.config';
import { AllowedEmail } from '../../models/AllowedEmail.entity';

const repo = () => AppDataSource.getRepository(AllowedEmail);

class AllowedEmailsService {

    async getAll(): Promise<AllowedEmail[]> {
        return repo().find({ order: { createdAt: 'DESC' } });
    }

    async add(email: string, addedBy: string): Promise<AllowedEmail> {
        const exists = await repo().findOne({ where: { email } });
        if (exists) throw { statusCode: 400, message: 'El correo ya está en la lista' };

        return repo().save(repo().create({ email, addedBy }));
    }

    async remove(id: number): Promise<void> {
        const exists = await repo().findOne({ where: { id } });
        if (!exists) throw { statusCode: 404, message: 'Correo no encontrado' };
        await repo().delete(id);
    }

    async isAllowed(email: string): Promise<boolean> {
        const found = await repo().findOne({ where: { email } });
        return !!found;
    }
}

export default new AllowedEmailsService();