import { afterEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { EnvService } from '../../src/common/env/env.service';
import { LoggerService, LogLevel } from '../../src/common/logger/logger.service';
import { AppConfig } from '../../src/config/app.config';
import { CryptoConfig } from '../../src/config/crypto.config';
import { DatabaseConfig } from '../../src/config/database.config';
import { KafkaConfig } from '../../src/config/kafka.config';
import { MailConfig } from '../../src/config/mail.config';
import { SensingConfig } from '../../src/config/sensing.config';
import { SocketConfig } from '../../src/config/socket.config';
import { decimalTransformer } from '../../src/models/numeric.transformer';
import { DataSourceToken, KafkaClientToken, LoggerToken, MailTransporterToken, SocketServerToken } from '../../src/common/di/tokens';
import { silenciar } from '../helpers/dobles';

/** Valor ausente, como el que llega de una columna sin dato. */
const SIN_VALOR: string | undefined = undefined;

/** EnvService falso: devuelve lo que se le indique y, si no, lo del entorno de pruebas. */
const envCon = (valores: Record<string, unknown>) => {
    const real = container.resolve(EnvService);
    return { get: (clave: string) => (clave in valores ? valores[clave] : real.get(clave as never)) } as unknown as EnvService;
};

afterEach(() => vi.restoreAllMocks());

describe('EnvService', () => {
    it('lee variables validadas con sus valores por defecto', () => {
        const env = new EnvService();
        expect(env.get('DB_PORT')).toBe(3306);
        expect(env.get('KAFKA_TOPIC')).toBe('test-topic');
        expect(env.isTest()).toBe(true);
        expect(env.isDevelopment()).toBe(false);
        expect(env.isProduction()).toBe(false);
    });

    it('detiene el arranque si falta una variable obligatoria, sin mostrar valores', () => {
        const original = process.env.JWT_SECRET;
        delete process.env.JWT_SECRET;
        try {
            expect(() => new EnvService()).toThrow(/Variables de entorno inválidas:\n\s+- JWT_SECRET/);
        } finally {
            process.env.JWT_SECRET = original;
        }
    });

    it.each([
        ['development', 'isDevelopment'],
        ['production', 'isProduction'],
    ] as const)('reconoce el modo %s', (modo, metodo) => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = modo;
        try {
            expect(new EnvService()[metodo]()).toBe(true);
        } finally {
            process.env.NODE_ENV = original;
        }
    });
});

describe('LoggerService', () => {
    it('escribe cada nivel en su salida con marca de tiempo', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(silenciar);
        const warn = vi.spyOn(console, 'warn').mockImplementation(silenciar);
        const log = vi.spyOn(console, 'log').mockImplementation(silenciar);
        const debug = vi.spyOn(console, 'debug').mockImplementation(silenciar);
        const logger = new LoggerService();
        const extra = { a: 1 };

        logger.error('e', extra);
        logger.warn('w');
        logger.info('i');
        logger.debug('d');

        expect(error.mock.calls[0][0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] \[ERROR\] e$/);
        expect(error.mock.calls[0][1]).toBe(extra);
        expect(warn.mock.calls[0][0]).toContain(`[${LogLevel.WARN}] w`);
        expect(log.mock.calls[0][0]).toContain('[INFO] i');
        expect(debug.mock.calls[0][0]).toContain('[DEBUG] d');
    });

    it('silencia DEBUG en producción', () => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const debug = vi.spyOn(console, 'debug').mockImplementation(silenciar);
        try {
            new LoggerService().debug('oculto');
            expect(debug).not.toHaveBeenCalled();
        } finally {
            process.env.NODE_ENV = original;
        }
    });
});

describe('Objetos de configuración', () => {
    it('AppConfig agrupa puerto, CORS, proxy y autenticación', () => {
        const cfg = new AppConfig(envCon({ PORT: 4000, CORS_ORIGIN: 'https://x.test', TRUST_PROXY: 2 }));
        expect(cfg.port).toBe(4000);
        expect(cfg.corsOrigin).toBe('https://x.test');
        expect(cfg.trustProxy).toBe(2);
        expect(cfg.auth).toMatchObject({ jwtSecret: 'x'.repeat(64), maxVerificationAttempts: expect.any(Number) });
    });

    it('CryptoConfig convierte las claves hex a 32 bytes', () => {
        const cfg = new CryptoConfig(container.resolve(EnvService));
        for (const clave of [cfg.dbEncryptionKey, cfg.dbHmacKey, cfg.frontendEncryptionKey, cfg.kafkaKey1, cfg.kafkaKey2]) {
            expect(clave).toHaveLength(32);
        }
        expect(cfg.kafkaNonceSize).toBe(8);
    });

    it('KafkaConfig separa brokers, recorta nombres y arma el TLS mutuo', () => {
        const cfg = new KafkaConfig(envCon({ KAFKA_BOOTSTRAP_SERVERS: 'a:1, b:2', KAFKA_TOPIC: ' t ', KAFKA_GROUP_ID: ' g ' }));
        expect(cfg.brokers).toEqual(['a:1', 'b:2']);
        expect(cfg.topic).toBe('t');
        expect(cfg.groupId).toBe('g');
        expect(cfg.maxMessageAgeSeconds).toEqual(expect.any(Number));
        expect(cfg.ssl).toEqual({ rejectUnauthorized: true, ca: [Buffer.from('ca\n')], cert: Buffer.from('cert\n'), key: Buffer.from('key\n') });
    });

    it.each([[465, true], [587, false]])('MailConfig con puerto %s usa TLS implícito=%s', (puerto, seguro) => {
        const cfg = new MailConfig(envCon({ MAIL_PORT: puerto }));
        expect(cfg.secure).toBe(seguro);
        expect([cfg.host, cfg.user, cfg.pass, cfg.from]).toEqual(['smtp.test', 'test@test.com', 'secret', 'no-reply@test.com']);
    });

    it('SensingConfig expone los parámetros del modelo', () => {
        const cfg = new SensingConfig(envCon({
            RSSI_REFERENCE_DBM: -45, PATH_LOSS_EXPONENT: 2.7, PRESENCIA_RSSI_MINIMO_DBM: -75, INFRAESTRUCTURA_VIGENCIA_HORAS: 24,
            AGGREGATION_INTERVAL_MINUTES: 5, OCCUPANCY_HIGH_RATIO: 0.8, OCCUPANCY_MEDIUM_RATIO: 0.5,
        }));
        expect(cfg.macHashKey).toHaveLength(32);
        expect([cfg.rssiReferenceDbm, cfg.pathLossExponent, cfg.presenciaRssiMinimoDbm, cfg.infraestructuraVigenciaHoras,
            cfg.aggregationIntervalMinutes, cfg.occupancyHighRatio, cfg.occupancyMediumRatio]).toEqual([-45, 2.7, -75, 24, 5, 0.8, 0.5]);
    });

    it('SocketConfig toma el origen de la aplicación', () => {
        const cfg = new SocketConfig({ corsOrigin: 'https://front.test' } as AppConfig);
        expect(cfg.corsOrigin).toBe('https://front.test');
        expect(cfg.corsMethods).toEqual(['GET', 'POST']);
    });
});

describe('DatabaseConfig', () => {
    it('sin CA cifra con TLS pero no verifica el certificado', () => {
        const db = new DatabaseConfig(envCon({ DB_SSL_CA: undefined }));
        expect(db.verificaCertificado).toBe(false);
        expect(db.dataSource.options).toMatchObject({ type: 'mysql', charset: 'utf8mb4', timezone: 'Z', ssl: { rejectUnauthorized: false } });
        expect((db.dataSource.options as { entities: unknown[] }).entities).toHaveLength(12);
    });

    it('con CA verifica el certificado del servidor', () => {
        const db = new DatabaseConfig(envCon({ DB_SSL_CA: Buffer.from('-----BEGIN CERTIFICATE-----').toString('base64') }));
        expect(db.verificaCertificado).toBe(true);
        expect(db.dataSource.options).toMatchObject({ ssl: { ca: '-----BEGIN CERTIFICATE-----', rejectUnauthorized: true } });
    });

    it('inicializa y cierra de forma idempotente', async () => {
        const db = new DatabaseConfig(envCon({}));
        const fuente = db.dataSource as unknown as { isInitialized: boolean };
        const initialize = vi.spyOn(db.dataSource, 'initialize').mockImplementation(() => {
            fuente.isInitialized = true;
            return Promise.resolve(db.dataSource);
        });
        const destroy = vi.spyOn(db.dataSource, 'destroy').mockImplementation(() => {
            fuente.isInitialized = false;
            return Promise.resolve();
        });

        await db.initialize();
        await db.initialize();
        await db.destroy();
        await db.destroy();

        expect(initialize).toHaveBeenCalledOnce();
        expect(destroy).toHaveBeenCalledOnce();
    });
});

describe('Utilidades de modelo e inyección', () => {
    it('el transformador decimal convierte el texto de MySQL a número', () => {
        expect(decimalTransformer.from('-67.50')).toBe(-67.5);
        expect(decimalTransformer.from(null)).toBeNull();
        expect(decimalTransformer.from(SIN_VALOR)).toBeNull();
        expect(decimalTransformer.to(3.2)).toBe(3.2);
        expect(decimalTransformer.to(SIN_VALOR)).toBeNull();
    });

    it('los tokens de inyección son símbolos únicos', () => {
        const tokens = [DataSourceToken, LoggerToken, SocketServerToken, KafkaClientToken, MailTransporterToken];
        expect(tokens.every((token) => typeof token === 'symbol')).toBe(true);
        expect(new Set(tokens).size).toBe(tokens.length);
    });
});
