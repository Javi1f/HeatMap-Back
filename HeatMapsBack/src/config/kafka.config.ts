import path from 'path';
import fs from 'fs';

const getEnvVar = (key: string, defaultValue?: string): string => {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Variable de entorno ${key} no está definida`);
    }
    return value;
};

export const BOOTSTRAP_SERVERS = getEnvVar('KAFKA_BOOTSTRAP_SERVERS').split(',');
export const KAFKA_TOPIC = getEnvVar('KAFKA_TOPIC');
export const KAFKA_GROUP_ID = getEnvVar('KAFKA_GROUP_ID');

export function getSSLConfig() {
    const caPath = path.resolve(getEnvVar('KAFKA_SSL_CA_PATH'));
    const certPath = path.resolve(getEnvVar('KAFKA_SSL_CERT_PATH'));
    const keyPath = path.resolve(getEnvVar('KAFKA_SSL_KEY_PATH'));

    if (!fs.existsSync(caPath)) {
        throw new Error(`Certificado CA no encontrado: ${caPath}`);
    }
    if (!fs.existsSync(certPath)) {
        throw new Error(`Certificado de servicio no encontrado: ${certPath}`);
    }
    if (!fs.existsSync(keyPath)) {
        throw new Error(`Llave privada no encontrada: ${keyPath}`);
    }

    return {
        ssl: {
            rejectUnauthorized: true,
            ca: [fs.readFileSync(caPath, 'utf-8')],
            cert: [fs.readFileSync(certPath, 'utf-8')],
            key: [fs.readFileSync(keyPath, 'utf-8')]
        }
    };
}

export const AES_KEY_1 = Buffer.from(getEnvVar('AES_KEY_1'), 'hex');
export const AES_KEY_2 = Buffer.from(getEnvVar('AES_KEY_2'), 'hex');
export const NONCE_SIZE = 8;
