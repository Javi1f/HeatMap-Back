import { AppDataSource } from '../../config/database.config';
import { AllowedEmail } from '../../models/AllowedEmail.entity';
import { encryptField, decryptField, hashField } from '../../utils/db-crypto.util';

const repo = () => AppDataSource.getRepository(AllowedEmail);

function decryptRecord(record: AllowedEmail): AllowedEmail {
    record.email = decryptField(record.email);
    if (record.addedBy) record.addedBy = decryptField(record.addedBy);
    return record;
}

class AllowedEmailsService {

    async getAll(): Promise<AllowedEmail[]> {
        const records = await repo().find({ order: { createdAt: 'DESC' } });
        return records.map(decryptRecord);
    }

    async add(email: string, addedBy: string): Promise<AllowedEmail> {
        const emailHash = hashField(email);
        const exists = await repo().findOne({ where: { emailHash } });
        if (exists) throw { statusCode: 400, message: 'El correo ya está en la lista' };

        const saved = await repo().save(repo().create({
            email: encryptField(email),
            emailHash,
            addedBy: encryptField(addedBy)
        }));

        return decryptRecord(saved);
    }

    async remove(id: number): Promise<void> {
        const exists = await repo().findOne({ where: { id } });
        if (!exists) throw { statusCode: 404, message: 'Correo no encontrado' };
        await repo().delete(id);
    }

    async isAllowed(email: string): Promise<boolean> {
        const emailHash = hashField(email);
        const found = await repo().findOne({ where: { emailHash } });
        return !!found;
    }
}

export default new AllowedEmailsService();
