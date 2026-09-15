import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/** Consumidor de kafkajs simulado. */
interface ConsumidorFalso {
    /** Nombres de los eventos que escucha el servicio. */
    events: Record<string, string>;
    /** Manejadores registrados, por evento, para dispararlos a mano. */
    manejadores: Record<string, (evento: unknown) => void>;
    /** Registro de manejadores. */
    on: Mock;
    /** Conexión al broker. */
    connect: Mock;
    /** Suscripción al topic. */
    subscribe: Mock;
    /** Bucle de consumo. */
    run: Mock;
    /** Desconexión. */
    disconnect: Mock;
}

/** Consumidor de kafkajs simulado: guarda los manejadores para dispararlos a mano. */
const { consumidores, Kafka } = vi.hoisted(() => {
    const creados: ConsumidorFalso[] = [];

    /** Crea un consumidor simulado y lo guarda para inspeccionarlo. */
    const nuevoConsumidor = (): ConsumidorFalso => {
        const manejadores: Record<string, (evento: unknown) => void> = {};
        const consumidor = {
            events: { GROUP_JOIN: 'consumer.group_join', CRASH: 'consumer.crash' },
            manejadores,
            on: vi.fn((evento: string, fn: (e: unknown) => void) => { manejadores[evento] = fn; }),
            connect: vi.fn(() => Promise.resolve()),
            subscribe: vi.fn(() => Promise.resolve()),
            run: vi.fn(() => Promise.resolve()),
            disconnect: vi.fn(() => Promise.resolve()),
        };
        creados.push(consumidor);
        return consumidor;
    };

    /** Cliente de kafkajs simulado: cada `consumer()` crea un consumidor nuevo. */
    class KafkaSimulado {
        /** Fábrica de consumidores. */
        consumer = vi.fn(nuevoConsumidor);
    }

    return { consumidores: creados, Kafka: vi.fn(KafkaSimulado) };
});
vi.mock('kafkajs', () => ({ Kafka }));

import { KafkaConsumerService } from '../../../src/modules/sensor/services/kafka-consumer.service';
import { MESSAGES } from '../../../src/constants/messages';
import { loggerFalso } from '../../helpers/dobles';

const cfg = { brokers: ['b:9093'], ssl: { rejectUnauthorized: true }, groupId: 'grupo', topic: 'lecturas', maxMessageAgeSeconds: 60 };

/** Consumidor con cifrador, procesador, emisor y logger falsos. */
const crear = () => {
    const dobles = {
        cipher: { decrypt: vi.fn() },
        processor: { processAndSave: vi.fn() },
        emitter: { emitSensorData: vi.fn() },
        logger: loggerFalso(),
    };
    const servicio = new KafkaConsumerService(cfg as never, dobles.cipher as never, dobles.processor as never, dobles.emitter as never, dobles.logger);
    return { servicio, ...dobles };
};

/** Último consumidor de kafkajs creado. */
const ultimo = () => consumidores[consumidores.length - 1];
/** Evento `CRASH` de kafkajs. */
const caida = (restart: boolean, error: Error) => ({ payload: { groupId: 'grupo', restart, error } });

let entorno: ReturnType<typeof crear>;
beforeEach(() => {
    consumidores.length = 0;
    Kafka.mockClear();
    entorno = crear();
});
afterEach(() => vi.useRealTimers());

describe('KafkaConsumerService: ciclo de vida', () => {
    it('se conecta con TLS, se suscribe sin releer el histórico y queda activo', async () => {
        await entorno.servicio.start();

        expect(Kafka).toHaveBeenCalledWith({ clientId: 'sensor-consumer', brokers: ['b:9093'], ssl: { rejectUnauthorized: true } });
        expect(ultimo().subscribe).toHaveBeenCalledWith({ topic: 'lecturas', fromBeginning: false });
        expect(entorno.servicio.running).toBe(true);
        expect(entorno.logger.info).toHaveBeenCalledWith(MESSAGES.CONSUMER.STARTED);
    });

    it('start y stop son idempotentes y reutilizan el cliente', async () => {
        await entorno.servicio.start();
        await entorno.servicio.start();
        expect(consumidores).toHaveLength(1);
        expect(entorno.logger.warn).toHaveBeenCalledWith(MESSAGES.CONSUMER.ALREADY_RUNNING);

        await entorno.servicio.stop();
        expect(ultimo().disconnect).toHaveBeenCalledOnce();
        expect(entorno.servicio.running).toBe(false);
        await entorno.servicio.stop();
        expect(entorno.logger.warn).toHaveBeenCalledWith(MESSAGES.CONSUMER.NOT_RUNNING);

        await entorno.servicio.start();
        expect(Kafka).toHaveBeenCalledTimes(1);
    });

    it('informa las particiones asignadas o que otra instancia las tiene', async () => {
        await entorno.servicio.start();
        const unirse = ultimo().manejadores['consumer.group_join'];

        unirse({ payload: { groupId: 'grupo', memberAssignment: { lecturas: [0, 1] } } });
        expect(entorno.logger.info).toHaveBeenCalledWith(`${MESSAGES.CONSUMER.GROUP_JOINED} grupo, particiones [0, 1]`);

        unirse({ payload: { groupId: 'grupo', memberAssignment: {} } });
        expect(entorno.logger.warn).toHaveBeenCalledWith(`${MESSAGES.CONSUMER.NO_PARTITIONS} (grupo)`);
    });
});

describe('KafkaConsumerService: caídas', () => {
    it('una caída recuperable sólo se registra: kafkajs se reinicia solo', async () => {
        await entorno.servicio.start();
        ultimo().manejadores['consumer.crash'](caida(true, new Error('red')));
        expect(entorno.logger.error).toHaveBeenCalledWith(`${MESSAGES.CONSUMER.CRASHED} (grupo): red.`);
        expect(entorno.servicio.running).toBe(true);
    });

    it('explica la causa interna cuando el grupo usa otro asignador', async () => {
        await entorno.servicio.start();
        const interna = Object.assign(new Error('protocolo'), { type: 'INCONSISTENT_GROUP_PROTOCOL' });
        ultimo().manejadores['consumer.crash'](caida(true, Object.assign(new Error('envoltorio'), { cause: interna })));
        expect(entorno.logger.error.mock.calls[0][0]).toContain(`protocolo. ${MESSAGES.CONSUMER.INCOMPATIBLE_GROUP}`);
    });

    it('ignora caídas tardías de un consumer que ya no es el vigente', async () => {
        await entorno.servicio.start();
        const viejo = ultimo();
        await entorno.servicio.stop();
        await entorno.servicio.start();
        viejo.manejadores['consumer.crash'](caida(false, new Error('tarde')));
        expect(entorno.servicio.running).toBe(true);
        expect(entorno.logger.error).not.toHaveBeenCalled();
    });

    it('no se marca activo si cayó sin remedio durante el arranque', async () => {
        vi.useFakeTimers();
        const primer = vi.fn();
        /** Cliente cuyo consumidor cae sin remedio durante `run`. */
        class KafkaQueCae {
            /** Fábrica de un consumidor que cae al unirse al grupo. */
            consumer = vi.fn(() => {
                const manejadores: Record<string, (e: unknown) => void> = {};
                const consumidor = {
                    events: { GROUP_JOIN: 'g', CRASH: 'c' }, manejadores,
                    on: vi.fn((evento: string, fn: (x: unknown) => void) => { manejadores[evento] = fn; }),
                    connect: vi.fn(), subscribe: vi.fn(), disconnect: vi.fn(),
                    run: vi.fn(() => {
                        primer();
                        manejadores.c(caida(false, new Error('rechazado')));
                        return Promise.resolve();
                    }),
                };
                consumidores.push(consumidor as unknown as ConsumidorFalso);
                return consumidor;
            });
        }
        Kafka.mockImplementationOnce(KafkaQueCae as never);

        await entorno.servicio.start();

        expect(primer).toHaveBeenCalled();
        expect(entorno.servicio.running).toBe(false);
        expect(entorno.logger.warn).toHaveBeenCalledWith(`${MESSAGES.CONSUMER.RESTARTING} 5 s`);
    });

    it('reintenta con espera creciente hasta 60 s y la reinicia al unirse al grupo', async () => {
        vi.useFakeTimers();
        await entorno.servicio.start();
        const cliente = Kafka.mock.results[0].value as { consumer: ReturnType<typeof vi.fn> };
        cliente.consumer.mockImplementation(() => {
            const consumidor = { ...consumidores[0], manejadores: {}, connect: vi.fn(() => Promise.reject(new Error('broker caído'))) };
            consumidores.push(consumidor);
            return consumidor;
        });

        consumidores[0].manejadores['consumer.crash'](caida(false, new Error('fatal')));
        expect(entorno.servicio.running).toBe(false);

        // Una segunda caída mientras hay un reintento pendiente no programa otro.
        (entorno.servicio as unknown as { consumer: unknown }).consumer = consumidores[0];
        consumidores[0].manejadores['consumer.crash'](caida(false, new Error('fatal')));

        for (const segundos of [5, 10, 20, 40, 60, 60]) {
            await vi.advanceTimersByTimeAsync(segundos * 1000); // skipcq: JS-0032
        }

        const esperas = entorno.logger.warn.mock.calls.map((llamada) => llamada[0]).filter((mensaje: string) => mensaje.startsWith(MESSAGES.CONSUMER.RESTARTING));
        expect(esperas).toEqual([5, 10, 20, 40, 60, 60, 60].map((segundos) => `${MESSAGES.CONSUMER.RESTARTING} ${segundos} s`));
        expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.CONSUMER.START_ERROR, expect.any(Error));

        // Detenerlo cancela el reintento pendiente.
        await entorno.servicio.stop();
        const intentos = consumidores.length;
        await vi.advanceTimersByTimeAsync(120_000);
        expect(consumidores).toHaveLength(intentos);
    });

    it('unirse al grupo devuelve la espera a 5 s', async () => {
        vi.useFakeTimers();
        await entorno.servicio.start();
        const primero = ultimo();
        primero.manejadores['consumer.crash'](caida(false, new Error('x')));
        await vi.advanceTimersByTimeAsync(5_000);
        const segundo = ultimo();
        segundo.manejadores['consumer.group_join']({ payload: { groupId: 'grupo', memberAssignment: { lecturas: [0] } } });
        segundo.manejadores['consumer.crash'](caida(false, new Error('y')));
        expect(entorno.logger.warn).toHaveBeenLastCalledWith(`${MESSAGES.CONSUMER.RESTARTING} 5 s`);
    });
});

describe('KafkaConsumerService: mensajes', () => {
    /** Arranca el consumidor y le entrega un mensaje de Kafka. */
    const mensaje = async (value: Buffer | null) => {
        await entorno.servicio.start();
        const { eachMessage } = ultimo().run.mock.calls[0][0];
        await eachMessage({ message: { value } });
    };

    it('descifra, guarda y difunde una lectura reciente', async () => {
        const ahora = Math.floor(Date.now() / 1000);
        entorno.cipher.decrypt.mockReturnValue({ sensor_id: 'nodo-1', total_devices: 2, timestamp: ahora, devices: [{ mac: 'x' }] });

        await mensaje(Buffer.alloc(40));

        const procesado = entorno.processor.processAndSave.mock.calls[0][0];
        expect(procesado).toMatchObject({ sensor_id: 'nodo-1', total_devices: 2, timestamp_raw: ahora, bytes_received: 40, devices: [{ mac: 'x' }] });
        expect(typeof procesado.timestamp).toBe('string');
        expect(entorno.emitter.emitSensorData).toHaveBeenCalledWith(procesado);
    });

    it('rellena campos ausentes del productor', async () => {
        entorno.cipher.decrypt.mockReturnValue({ timestamp: Math.floor(Date.now() / 1000) });
        await mensaje(Buffer.alloc(20));
        expect(entorno.processor.processAndSave.mock.calls[0][0]).toMatchObject({ sensor_id: '?', total_devices: 0, devices: [] });
    });

    it('avisa de un mensaje vacío', async () => {
        await mensaje(null);
        expect(entorno.logger.warn).toHaveBeenCalledWith(MESSAGES.KAFKA.EMPTY_MESSAGE);
        expect(entorno.cipher.decrypt).not.toHaveBeenCalled();
    });

    it('un mensaje corrupto se registra sin tumbar el consumer', async () => {
        entorno.cipher.decrypt.mockImplementation(() => { throw new Error('corrupto'); });
        await expect(mensaje(Buffer.alloc(5))).resolves.toBeUndefined();
        expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.KAFKA.DECRYPT_ERROR, expect.any(Error));
        expect(entorno.servicio.running).toBe(true);
    });

    it('descarta lo antiguo avisando como mucho una vez por minuto', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-14T12:00:00Z'));
        const ahora = Math.floor(Date.now() / 1000);
        entorno.cipher.decrypt.mockReturnValue({ sensor_id: 'n', total_devices: 0, timestamp: ahora - 300, devices: [] });

        await entorno.servicio.start();
        const { eachMessage } = ultimo().run.mock.calls[0][0];
        await eachMessage({ message: { value: Buffer.alloc(20) } });
        await eachMessage({ message: { value: Buffer.alloc(20) } });
        vi.setSystemTime(new Date('2026-09-14T12:01:00Z'));
        await eachMessage({ message: { value: Buffer.alloc(20) } });

        const avisos = entorno.logger.warn.mock.calls.map((llamada) => llamada[0] as string).filter((aviso) => aviso.includes(MESSAGES.KAFKA.STALE_DISCARDED));
        expect(avisos).toEqual([
            `1 ${MESSAGES.KAFKA.STALE_DISCARDED} (límite 60 s, el más antiguo 300 s)`,
            `2 ${MESSAGES.KAFKA.STALE_DISCARDED} (límite 60 s, el más antiguo 360 s)`,
        ]);
        expect(entorno.processor.processAndSave).not.toHaveBeenCalled();
    });
});
