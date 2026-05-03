import { DataSource } from 'typeorm';
import { Admin } from '../models/Admin.entity';
import { PendingRegistration } from '../models/PendingRegistration.entity';
import { AllowedEmail } from '../models/AllowedEmail.entity';

const getEnvVar = (key: string, defaultValue?: string): string => {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Variable de entorno ${key} no está definida`);
    }
    return value;
};

export const AppDataSource = new DataSource({
    type: 'mysql',
    host: getEnvVar('DB_HOST', 'localhost'),
    port: parseInt(getEnvVar('DB_PORT', '3306'), 10),
    username: getEnvVar('DB_USERNAME'),
    password: getEnvVar('DB_PASSWORD'),
    database: getEnvVar('DB_DATABASE'),
    synchronize: getEnvVar('DB_SYNCHRONIZE', 'false') === 'true',
    logging: getEnvVar('DB_LOGGING', 'false') === 'true',
    entities: [Admin, PendingRegistration, AllowedEmail],
    migrations: [],
    subscribers: [],
    charset: 'utf8mb4',
    timezone: 'Z'
});
