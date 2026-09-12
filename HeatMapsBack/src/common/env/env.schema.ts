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
 * Helper para decimales provenientes de string (ej. el exponente de
 * atenuación, que rara vez es entero).
 */
const floatFromString = (defaultValue: number) =>
    z
        .preprocess(
            (v) => (typeof v === 'string' && v.length > 0 ? Number(v) : v),
            z.number(),
        )
        .default(defaultValue);

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

/**
 * Tope de vida de una sesión, en segundos.
 *
 * Una hora. El sistema trata datos de presencia de personas, así que una
 * sesión olvidada abierta en un equipo compartido es el riesgo a acotar, no la
 * comodidad de no volver a entrar.
 */
const SEGUNDOS_MAXIMOS_SESION = 60 * 60;

/** Unidades que admite `jsonwebtoken` en su cadena de expiración. */
const SEGUNDOS_POR_UNIDAD: Readonly<Record<string, number>> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
};

/**
 * Convierte una duración tipo `30m`, `2h` o `3600` a segundos.
 *
 * @returns Los segundos, o `null` si el texto no se entiende.
 */
const aSegundos = (texto: string): number | null => {
    const limpio = texto.trim().toLowerCase();
    const coincidencia = /^(\d+)\s*([smhd])?$/.exec(limpio);
    if (!coincidencia) return null;

    const [, cantidad, unidad] = coincidencia;
    return Number(cantidad) * (unidad ? SEGUNDOS_POR_UNIDAD[unidad] : 1);
};

/**
 * Duración con un tope máximo, comprobado al arrancar.
 *
 * Se valida en lugar de recortar en silencio: si el despliegue pide ocho horas
 * de sesión, es mejor que no arranque y se vea, a que arranque emitiendo algo
 * distinto de lo que dice su configuración.
 */
const duracionAcotada = (porDefecto: string, maximoSegundos: number) =>
    z
        .string()
        .default(porDefecto)
        .refine((valor) => aSegundos(valor) !== null, {
            message: 'debe ser una duración como 45m, 1h o 3600',
        })
        .refine((valor) => (aSegundos(valor) ?? Infinity) <= maximoSegundos, {
            message: `no puede pasar de ${maximoSegundos / 60} minutos`,
        });

/** Esquema Zod que valida y normaliza todas las variables de entorno. */
export const envSchema = z.object({
    /** Entorno de ejecución. Determina el nivel de log y los mensajes de error. */
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    /** Puerto TCP donde escucha el servidor HTTP. */
    PORT: intFromString(3000),

    /** Host del servidor MySQL. */
    DB_HOST: z.string().min(1),

    /** Puerto del servidor MySQL. */
    DB_PORT: intFromString(),

    /** Usuario de conexión a MySQL. */
    DB_USERNAME: z.string().min(1),

    /** Contraseña de conexión a MySQL. */
    DB_PASSWORD: z.string().min(1),

    /** Nombre del esquema de base de datos. */
    DB_DATABASE: z.string().min(1),

    /**
     * Si TypeORM debe crear y alterar las tablas según las entidades al
     * arrancar. En producción implica que el esquema real lo define el código,
     * no el DDL versionado.
     */
    DB_SYNCHRONIZE: boolFromString(false),

    /** Si TypeORM debe volcar cada consulta al log. */
    DB_LOGGING: boolFromString(false),

    /** Clave AES-256-GCM para cifrar campos sensibles en la base de datos. */
    DB_ENCRYPTION_KEY: hexKey(32),

    /** Clave HMAC-SHA256 para el hashing determinista de campos buscables. */
    DB_HMAC_KEY: hexKey(32),

    /** Clave AES-256-GCM de los payloads intercambiados con el frontend. */
    FRONTEND_ENCRYPTION_KEY: hexKey(32),

    /** Lista de brokers de Kafka separados por coma. */
    KAFKA_BOOTSTRAP_SERVERS: z.string().min(1),

    /** Topic del que se consumen las lecturas de los nodos de captura. */
    KAFKA_TOPIC: z.string().min(1),

    /**
     * Grupo de consumidores, que determina el reparto de particiones.
     *
     * Debe ser exclusivo del backend y el mismo en todas sus instancias. Si
     * otro cliente comparte el grupo, el tópico de una sola partición sólo lo
     * lee uno de los dos, y si ese cliente negoció otro asignador —kafka-python
     * usa `range`, kafkajs `RoundRobinAssigner`— el broker ni siquiera admite
     * al backend. Instancias del backend con grupos distintos, en cambio,
     * leerían cada una todos los mensajes y duplicarían las capturas.
     */
    KAFKA_GROUP_ID: z.string().min(1),

    /** Autoridad certificadora del broker, en PEM. */
    KAFKA_SSL_CA: z.string().min(1),

    /** Certificado de cliente para autenticarse ante el broker, en PEM. */
    KAFKA_SSL_CERT: z.string().min(1),

    /** Clave privada del certificado de cliente, en PEM. */
    KAFKA_SSL_KEY: z.string().min(1),

    /**
     * Antigüedad máxima admitida en un mensaje. Los más viejos se descartan
     * para que un reinicio no reprocese horas de lecturas como si fueran
     * actuales.
     */
    KAFKA_MAX_MESSAGE_AGE_SECONDS: intFromString(60),

    /** Primera clave AES-256-CTR de la cascada de cifrado de Kafka. */
    AES_KEY_1: hexKey(32),

    /** Segunda clave AES-256-CTR de la cascada de cifrado de Kafka. */
    AES_KEY_2: hexKey(32),

    /** Secreto de firma de los JWT. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),

    /**
     * Validez de los JWT emitidos, en formato de `jsonwebtoken` (ej. `45m`).
     *
     * Acotada a una hora: ver {@link SEGUNDOS_MAXIMOS_SESION}.
     */
    JWT_EXPIRES_IN: duracionAcotada('1h', SEGUNDOS_MAXIMOS_SESION),

    /** Intentos de código de verificación antes de invalidar el registro. */
    MAX_VERIFICATION_ATTEMPTS: intFromString(3),

    /** Minutos de validez del código de verificación enviado por correo. */
    VERIFICATION_CODE_EXPIRES_MINUTES: intFromString(15),

    /** Host del servidor SMTP de salida. */
    MAIL_HOST: z.string().min(1),

    /** Puerto del servidor SMTP. */
    MAIL_PORT: intFromString(587),

    /** Usuario de autenticación SMTP. */
    MAIL_USER: z.string().email(),

    /** Contraseña de autenticación SMTP. */
    MAIL_PASS: z.string().min(1),

    /** Dirección que figura como remitente en los correos enviados. */
    MAIL_FROM: z.string().email(),

    /** Clave HMAC-SHA256 con la que se anonimizan las direcciones MAC. */
    MAC_HASH_KEY: hexKey(32),

    /**
     * Potencia recibida de referencia a un metro, en dBm.
     *
     * Valor inicial tomado de literatura; se recalibra por espacio durante las
     * pruebas, ya que depende de la antena y de la altura del nodo.
     */
    RSSI_REFERENCE_DBM: floatFromString(-40),

    /**
     * Exponente de atenuación del entorno: en torno a 2 en espacio libre y
     * entre 2,7 y 4 en interiores con obstrucción.
     */
    PATH_LOSS_EXPONENT: floatFromString(3.0),

    /** Duración de la ventana de consolidación de ocupación, en minutos. */
    AGGREGATION_INTERVAL_MINUTES: intFromString(5),

    /** Fracción del aforo a partir de la cual la ocupación se considera alta. */
    OCCUPANCY_HIGH_RATIO: floatFromString(0.85),

    /** Fracción del aforo a partir de la cual se considera media. */
    OCCUPANCY_MEDIUM_RATIO: floatFromString(0.5),

    /** Origen admitido en las cabeceras CORS. */
    CORS_ORIGIN: z.string().default('*'),

    /*
     * Saltos de proxy en los que confiar para deducir la IP del cliente.
     *
     * `0` (por defecto) es lo correcto en local, sin nada delante. Detrás de un
     * proxy —Northflank pone uno— hay que subirlo a `1`, o Express toma la IP
     * del proxy como la del cliente: el limitador de tasa mete a todos los
     * usuarios en el mismo cubo y las sesiones registran siempre la misma IP.
     *
     * No se pone `true` a secas a propósito: eso haría confiar en cualquier
     * `X-Forwarded-For`, y entonces un cliente podría inventarse la cabecera
     * para saltarse el límite de peticiones.
     */
    TRUST_PROXY: intFromString(0),
});

/**
 * Forma tipada de las variables de entorno ya validadas y normalizadas.
 */
export type Env = z.infer<typeof envSchema>;
