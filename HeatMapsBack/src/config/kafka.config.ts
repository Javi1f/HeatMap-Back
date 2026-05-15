const getEnvVar = (key: string, defaultValue?: string): string => {
    const value = process.env[key] || defaultValue;
    if (!value) {
        throw new Error(`Variable de entorno ${key} no está definida`);
    }
    return value.trim();
};

export const BOOTSTRAP_SERVERS = getEnvVar('KAFKA_BOOTSTRAP_SERVERS').split(',');
export const KAFKA_TOPIC = getEnvVar('KAFKA_TOPIC');
export const KAFKA_GROUP_ID = getEnvVar('KAFKA_GROUP_ID');

export function getSSLConfig() {
    const ca   = Buffer.from(getEnvVar('KAFKA_SSL_CA'),   'base64');
    const cert = Buffer.from(getEnvVar('KAFKA_SSL_CERT'), 'base64');
    const key  = Buffer.from(getEnvVar('KAFKA_SSL_KEY'),  'base64');

    return {
        ssl: {
            rejectUnauthorized: true,
            ca:   [ca],
            cert: cert,
            key:  key
        }
    };
}

export const AES_KEY_1 = Buffer.from(getEnvVar('AES_KEY_1'), 'hex');
export const AES_KEY_2 = Buffer.from(getEnvVar('AES_KEY_2'), 'hex');
export const NONCE_SIZE = 8;
