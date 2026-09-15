import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silenciar } from './helpers/dobles';

/*
 * Arranque (`index.ts`) y carga del `.env` (`loadEnv.ts`). Los dos se ejecutan
 * al importarse, así que cada prueba reinicia el registro de módulos y vuelve a
 * importarlos con los dobles que necesita.
 */

const { dotenv, existe, servidor } = vi.hoisted(() => ({
    dotenv: { config: vi.fn() },
    existe: { valor: null as boolean | null },
    servidor: {
        listen: vi.fn((_puerto: number, listo: () => void) => listo()),
        close: vi.fn((hecho: (err?: Error) => void) => hecho()),
    },
}));

vi.mock('dotenv', () => ({ default: dotenv }));
vi.mock('fs', async (original) => {
    const real = (await original()) as typeof import('fs');
    /** `existsSync` controlable: con `existe.valor` en `null` consulta el disco real. */
    const existsSync = (ruta: string) => (existe.valor === null ? real.existsSync(ruta) : existe.valor);
    return { ...real, default: { ...real, existsSync }, existsSync };
});
vi.mock('http', async (original) => {
    const real = (await original()) as typeof import('http');
    const createServer = vi.fn(() => servidor);
    return { ...real, default: { ...real, createServer }, createServer };
});

/** Cede un turno del bucle de eventos para que terminen las promesas pendientes. */
const esperar = () => new Promise((resolver) => {
    setImmediate(resolver);
});

describe('loadEnv', () => {
    let argv: string[];
    beforeEach(() => {
        vi.resetModules();
        dotenv.config.mockClear();
        argv = process.argv;
        existe.valor = null;
    });
    afterEach(() => {
        process.argv = argv;
        existe.valor = null;
    });

    it('sube desde el archivo de entrada hasta la carpeta con package.json', async () => {
        const raiz = path.resolve(__dirname, '..');
        process.argv = ['node', path.join(raiz, 'src', 'scripts', 'respaldo-bd.ts')];
        await import('../src/loadEnv');
        expect(dotenv.config).toHaveBeenCalledWith({ path: path.join(raiz, '.env') });
    });

    it('sin archivo de entrada parte del directorio actual', async () => {
        process.argv = ['node'];
        existe.valor = true;
        await import('../src/loadEnv');
        expect(dotenv.config).toHaveBeenCalledWith({ path: path.join(process.cwd(), '.env') });
    });

    it('si no encuentra package.json usa el padre del directorio de entrada', async () => {
        existe.valor = false;
        const entrada = path.join(path.parse(process.cwd()).root, 'a', 'b', 'app.js');
        process.argv = ['node', entrada];
        await import('../src/loadEnv');
        expect(dotenv.config).toHaveBeenCalledWith({ path: path.join(path.resolve(path.dirname(entrada), '..'), '.env') });
    });
});

describe('index: arranque y cierre', () => {
    /** Dobles que devuelve `preparar`, para que cada prueba los consulte. */
    type Dobles = Awaited<ReturnType<typeof preparar>>;
    let senales: Record<string, (s: string) => void>;

    /** Reinicia los módulos y registra dobles de base de datos, sockets, Kafka y agregador. */
    const preparar = async (ajustes: { sinCa?: boolean; kafkaFalla?: boolean; bdFalla?: boolean } = {}) => {
        vi.resetModules();
        const { container } = await import('tsyringe');
        const { LoggerService } = await import('../src/common/logger/logger.service');
        const { AppConfig } = await import('../src/config/app.config');
        const { DatabaseConfig } = await import('../src/config/database.config');
        const { SocketEmitterService } = await import('../src/modules/sensor/services/socket-emitter.service');
        const { KafkaConsumerService } = await import('../src/modules/sensor/services/kafka-consumer.service');
        const { OccupancyAggregatorService } = await import('../src/modules/sensor/services/occupancy-aggregator.service');

        const dobles = {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            db: {
                verificaCertificado: !ajustes.sinCa,
                initialize: vi.fn(() => (ajustes.bdFalla ? Promise.reject(new Error('sin base')) : Promise.resolve())),
                destroy: vi.fn(),
            },
            emitter: { initialize: vi.fn(), close: vi.fn() },
            consumer: { start: vi.fn(() => (ajustes.kafkaFalla ? Promise.reject(new Error('sin kafka')) : Promise.resolve())), stop: vi.fn() },
            aggregator: { start: vi.fn(), stop: vi.fn() },
        };
        container.registerInstance(LoggerService, dobles.logger as never);
        container.registerInstance(AppConfig, { port: 3999, corsOrigin: '*', trustProxy: 0, auth: {} } as never);
        container.registerInstance(DatabaseConfig, dobles.db as never);
        container.registerInstance(SocketEmitterService, dobles.emitter as never);
        container.registerInstance(KafkaConsumerService, dobles.consumer as never);
        container.registerInstance(OccupancyAggregatorService, dobles.aggregator as never);
        vi.doMock('../src/app', () => ({ createApp: vi.fn(() => ({})) }));
        vi.doMock('../src/loadEnv', () => ({}));
        return dobles;
    };

    /** Importa `index.ts`, que arranca solo, y espera a que termine el arranque. */
    const arrancar = async (dobles: Dobles) => {
        await import('../src/index');
        await esperar();
        return dobles;
    };

    beforeEach(() => {
        senales = {};
        servidor.listen.mockClear();
        servidor.close.mockReset().mockImplementation((hecho: (err?: Error) => void) => hecho());
        vi.spyOn(process, 'on').mockImplementation(((evento: string, fn: (s: string) => void) => { senales[evento] = fn; return process; }) as never);
        process.exitCode = undefined;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        process.exitCode = undefined;
    });

    it('conecta la base, escucha, inicia sockets, Kafka y el agregador', async () => {
        const dobles = await arrancar(await preparar());
        expect(dobles.db.initialize).toHaveBeenCalledOnce();
        expect(servidor.listen).toHaveBeenCalledWith(3999, expect.any(Function));
        expect(dobles.emitter.initialize).toHaveBeenCalledWith(servidor);
        expect(dobles.consumer.start).toHaveBeenCalledOnce();
        expect(dobles.aggregator.start).toHaveBeenCalledOnce();
        expect(dobles.logger.warn).not.toHaveBeenCalled();
        expect(Object.keys(senales)).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM']));
    });

    it('advierte si la base no verifica el certificado', async () => {
        const dobles = await arrancar(await preparar({ sinCa: true }));
        expect(dobles.logger.warn.mock.calls[0][0]).toContain('DB_SSL_CA no configurada');
    });

    it('sin Kafka sigue sirviendo y consolidando', async () => {
        const dobles = await arrancar(await preparar({ kafkaFalla: true }));
        expect(dobles.logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
        expect(dobles.aggregator.start).toHaveBeenCalledOnce();
    });

    it('sin base de datos termina con código 1', async () => {
        const fatal = vi.spyOn(console, 'error').mockImplementation(silenciar);
        await arrancar(await preparar({ bdFalla: true }));
        expect(fatal).toHaveBeenCalledWith('Error fatal al inicializar la aplicación', expect.any(Error));
        expect(process.exitCode).toBe(1);
    });

    it('SIGTERM cierra en orden inverso y sale con 0', async () => {
        const dobles = await arrancar(await preparar());
        senales.SIGTERM('SIGTERM');
        await esperar();
        await esperar();

        expect(dobles.aggregator.stop).toHaveBeenCalled();
        expect(dobles.consumer.stop.mock.invocationCallOrder[0]).toBeLessThan(dobles.emitter.close.mock.invocationCallOrder[0]);
        expect(servidor.close.mock.invocationCallOrder[0]).toBeLessThan(dobles.db.destroy.mock.invocationCallOrder[0]);
        expect(dobles.logger.info).toHaveBeenCalledWith('Shutdown completo');
        expect(process.exitCode).toBe(0);
    });

    it('un fallo al cerrar deja código 1', async () => {
        const dobles = await arrancar(await preparar());
        servidor.close.mockImplementation((hecho: (err?: Error) => void) => hecho(new Error('ocupado')));
        senales.SIGINT('SIGINT');
        await esperar();
        await esperar();
        expect(dobles.logger.error).toHaveBeenCalledWith('Error durante shutdown', expect.any(Error));
        expect(process.exitCode).toBe(1);
    });

    it('un fallo fuera del cierre controlado también deja código 1', async () => {
        const dobles = await arrancar(await preparar());
        dobles.logger.info.mockImplementation((mensaje: string) => { if (mensaje.startsWith('Señal')) throw new Error('log roto'); });
        senales.SIGINT('SIGINT');
        await esperar();
        expect(dobles.logger.error).toHaveBeenCalledWith('Fallo no manejado en shutdown', expect.any(Error));
        expect(process.exitCode).toBe(1);
    });
});
