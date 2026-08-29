import 'reflect-metadata';

/**
 * Variables de entorno mínimas para que `EnvService` no falle al cargarse
 * desde tests. Se inyectan ANTES de cualquier import que dependa de env.
 */
const HEX32 = 'a'.repeat(64);

process.env.NODE_ENV = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USERNAME = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_DATABASE = 'test';
process.env.DB_ENCRYPTION_KEY = HEX32;
process.env.DB_HMAC_KEY = HEX32;
process.env.FRONTEND_ENCRYPTION_KEY = HEX32;
process.env.KAFKA_BOOTSTRAP_SERVERS = 'localhost:9092';
process.env.KAFKA_TOPIC = 'test-topic';
process.env.KAFKA_GROUP_ID = 'test-group';
process.env.KAFKA_SSL_CA = 'Y2EK';
process.env.KAFKA_SSL_CERT = 'Y2VydAo=';
process.env.KAFKA_SSL_KEY = 'a2V5Cg==';
process.env.MAC_HASH_KEY = HEX32;
process.env.AES_KEY_1 = HEX32;
process.env.AES_KEY_2 = HEX32;
process.env.JWT_SECRET = 'x'.repeat(64);
process.env.MAIL_HOST = 'smtp.test';
process.env.MAIL_USER = 'test@test.com';
process.env.MAIL_PASS = 'secret';
process.env.MAIL_FROM = 'no-reply@test.com';
