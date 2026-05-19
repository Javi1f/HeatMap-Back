import { z } from 'zod';

/**
 * Esquema de validación de variables de entorno.
 *
 * Cada variable se documenta y se valida con Zod. Si falta una variable
 * obligatoria o tiene un formato inválido, la aplicación se detiene
 * inmediatamente al arrancar — preferimos fallar rápido a fallar tarde.
 *
 * Centraliza:
 *  - Documentación de cada variable.
 *  - Validación de formato (tipo, longitud, valores permitidos).
 *  - Valores por defecto donde aplica.
 *
 * NO se exporta el resultado del parse aquí; eso lo hace `env.service.ts`
 * en el bootstrap, para garantizar que `dotenv` ya cargó el `.env`.
 */

/**
 * Helper para parsear claves hexadecimales de exactamente N bytes
 * (es decir, N*2 caracteres hex).
 */
const hexKey = (bytes: number) =>
    z
        .string()
        .regex(/^[0-9a-fA-F]+$/, 'debe ser hexadecimal')
        .length(bytes * 2, `debe tener ${bytes * 2} caracteres (${bytes} bytes)`);

/**
 * Helper para enteros provenientes de string (process.env siempre es string).
 */
const intFromString = (defaultValue?: number) => {
    const base = z.preprocess(
        (v) => (typeof v === 'string' && v.length > 0 ? Number(v) : v),
        z.number().int(),
    );
    return defaultValue === undefined ? base : base.default(defaultValue);
};

/**
 * Helper para boolean provenientes de string ("true"/"false").
 */
const boolFromString = (defaultValue: boolean) =>
    z
        .preprocess(
            (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v),
            z.boolean(),
        )
        .default(defaultValue);

export const envSchema = z.object({
    // Entorno y servidor
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: intFromString(3000),

    // Base de datos
    DB_HOST: z.string().min(1),
    DB_PORT: intFromString(),
    DB_USERNAME: z.string().min(1),
    DB_PASSWORD: z.string().min(1),
    DB_DATABASE: z.string().min(1),
    DB_SYNCHRONIZE: boolFromString(false),
    DB_LOGGING: boolFromString(false),

    // Cifrado de campos en DB
    DB_ENCRYPTION_KEY: hexKey(32),
    DB_HMAC_KEY: hexKey(32),

    // Cifrado de payloads de la API frontend ↔ backend
    FRONTEND_ENCRYPTION_KEY: hexKey(32),

    // Kafka
    KAFKA_BOOTSTRAP_SERVERS: z.string().min(1),
    KAFKA_TOPIC: z.string().min(1),
    KAFKA_GROUP_ID: z.string().min(1),
    KAFKA_SSL_CA: z.string().min(1),
    KAFKA_SSL_CERT: z.string().min(1),
    KAFKA_SSL_KEY: z.string().min(1),
    KAFKA_MAX_MESSAGE_AGE_SECONDS: intFromString(60),

    // Cifrado de payloads de Kafka (doble capa)
    AES_KEY_1: hexKey(32),
    AES_KEY_2: hexKey(32),

    // JWT
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().default('24h'),

    // Verificación por correo
    MAX_VERIFICATION_ATTEMPTS: intFromString(3),
    VERIFICATION_CODE_EXPIRES_MINUTES: intFromString(15),

    // SMTP
    MAIL_HOST: z.string().min(1),
    MAIL_PORT: intFromString(587),
    MAIL_USER: z.string().email(),
    MAIL_PASS: z.string().min(1),
    MAIL_FROM: z.string().email(),

    // CORS
    CORS_ORIGIN: z.string().default('*'),
});

/**
 * Forma tipada de las variables de entorno ya validadas y normalizadas.
 */
export type Env = z.infer<typeof envSchema>;
