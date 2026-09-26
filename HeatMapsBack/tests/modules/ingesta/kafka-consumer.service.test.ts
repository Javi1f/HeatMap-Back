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
    /** Reposicionamiento en una partición. */
    seek?: Mock;
}

/** Consumidor de kafkajs simulado: guarda los manejadores para dispararlos a mano. */
const { consumidores, administradores, Kafka } = vi.hoisted(() => {
    const creados: ConsumidorFalso[] = [];
    const admins: { connect: Mock; fetchTopicOffsets: Mock; fetchTopicOffsetsByTimestamp: Mock; fetchOffsets: Mock; disconnect: Mock }[] = [];

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
            seek: vi.fn(),
        };
        creados.push(consumidor);
        return consumidor;
    };

    /** Crea un cliente de administración simulado y lo guarda para inspeccionarlo. */
    const nuevoAdmin = () => {
        const admin = {
            connect: vi.fn(() => Promise.resolve()),
            fetchTopicOffsets: vi.fn(() => Promise.resolve([{ partition: 0, high: '2000', low: '0' }])),
            // Por defecto el grupo va al día: lo confirmado coincide con lo vigente.
            fetchTopicOffsetsByTimestamp: vi.fn(() => Promise.resolve([{ partition: 0, offset: '2000' }])),
            fetchOffsets: vi.fn(() => Promise.resolve([{ topic: 'lecturas', partitions: [{ partition: 0, offset: '2000' }] }])),
            disconnect: vi.fn(() => Promise.resolve()),
        };
        admins.push(admin);
        return admin;
    };

    /** Cliente de kafkajs simulado: cada `consumer()` crea un consumidor nuevo. */
    class KafkaSimulado {
        /** Fábrica de consumidores. */
        consumer = vi.fn(nuevoConsumidor);

        /** Fábrica de clientes de administración. */
        admin = vi.fn(nuevoAdmin);
    }

    return { consumidores: creados, administradores: admins, Kafka: vi.fn(KafkaSimulado) };
});
vi.mock('kafkajs', () => ({ Kafka }));

import { KafkaConsumerService } from '../../../src/modules/ingesta/kafka-consumer.service';
import { MESSAGES } from '../../../src/constants/messages';
import { loggerFalso } from '../../helpers/dobles';

const cfg = { brokers: ['b:9093'], ssl: { rejectUnauthorized: true }, groupId: 'grupo', topic: 'lecturas', maxMessageAgeSeconds: 60 };

/** Consumidor con cifrador, procesador, emisor y logger falsos. */
const crear = () => {
    const dobles = {
        cipher: { decrypt: vi.fn() },
        processor: { processAndSave: vi.fn(() => Promise.resolve(1)) },
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
    administradores.length = 0;
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
        await eachMessage({ topic: 'lecturas', partition: 0, message: { value, offset: '10' } });
    };

    it('descifra, valida, guarda y difunde solo el resumen', async () => {
        const ahora = Math.floor(Date.now() / 1000);
        entorno.cipher.decrypt.mockReturnValue({
            sensor_id: 'nodo-1', total_devices: 2, timestamp: ahora,
            devices: [
                { mac: '10:00:00:00:00:01', rssi: -60.4, channel: 6, status: 'PROBING', ssid: 'red-de-casa' },
                { mac: '10:00:00:00:00:02', rssi: 40 },
            ],
        });

        await mensaje(Buffer.alloc(40));

        // Solo pasa el dispositivo válido, y sin campos que el sistema no usa.
        expect(entorno.processor.processAndSave).toHaveBeenCalledWith({
            sensorId: 'nodo-1', timestamp: ahora,
            dispositivos: [{ mac: '10:00:00:00:00:01', rssi: -60, canal: 6, tipoTrama: 'probing' }],
        });
        expect(entorno.logger.debug).toHaveBeenCalledWith(`1 ${MESSAGES.KAFKA.INVALID_DEVICES}`);
        const [resumen] = entorno.emitter.emitSensorData.mock.calls[0];
        expect(Object.keys(resumen).sort()).toEqual(['received_at', 'timestamp', 'total_devices']);
        expect(resumen.total_devices).toBe(1);
    });

    it('descarta una lectura sin la estructura esperada, sin llegar a guardarla', async () => {
        entorno.cipher.decrypt.mockReturnValue({ timestamp: Math.floor(Date.now() / 1000) });
        await mensaje(Buffer.alloc(20));
        expect(entorno.processor.processAndSave).not.toHaveBeenCalled();
        expect(entorno.logger.warn).toHaveBeenCalledWith(expect.stringContaining(MESSAGES.KAFKA.INVALID_PAYLOAD));
    });

    it('un fallo al guardar se registra como tal, no como un error de descifrado', async () => {
        entorno.cipher.decrypt.mockReturnValue({ sensor_id: 'n', timestamp: Math.floor(Date.now() / 1000), devices: [] });
        entorno.processor.processAndSave.mockRejectedValueOnce(new Error('base caída'));
        await expect(mensaje(Buffer.alloc(20))).resolves.toBeUndefined();
        expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.KAFKA.PROCESS_ERROR, expect.any(Error));
        expect(entorno.emitter.emitSensorData).not.toHaveBeenCalled();
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
        const viejo = { topic: 'lecturas', partition: 0, message: { value: Buffer.alloc(20), offset: '7' } };
        await eachMessage(viejo);
        await eachMessage(viejo);
        vi.setSystemTime(new Date('2026-09-14T12:01:00Z'));
        await eachMessage(viejo);

        const avisos = entorno.logger.warn.mock.calls.map((llamada) => llamada[0] as string).filter((aviso) => aviso.includes(MESSAGES.KAFKA.STALE_DISCARDED));
        expect(avisos).toEqual([
            `1 ${MESSAGES.KAFKA.STALE_DISCARDED} (límite 60 s, el más antiguo 300 s)`,
            `2 ${MESSAGES.KAFKA.STALE_DISCARDED} (límite 60 s, el más antiguo 360 s)`,
        ]);
        expect(entorno.processor.processAndSave).not.toHaveBeenCalled();
    });
});

describe('KafkaConsumerService: cola atrasada', () => {
    /** Entrega `veces` mensajes con la antigüedad indicada y devuelve el consumidor de kafkajs. */
    const entregar = async (veces: number, antiguedadS: number, offset = '1550') => {
        entorno.cipher.decrypt.mockReturnValue({
            sensor_id: 'n', total_devices: 0, devices: [], timestamp: Math.floor(Date.now() / 1000) - antiguedadS,
        });
        const { eachMessage } = ultimo().run.mock.calls[0][0];
        for (let entrega = 0; entrega < veces; entrega++) {
            await eachMessage({ topic: 'lecturas', partition: 0, message: { value: Buffer.alloc(20), offset } }); // skipcq: JS-0032
        }
        return ultimo();
    };

    /** Avisos de mensajes omitidos que registró el servicio. */
    const omisiones = () => entorno.logger.warn.mock.calls
        .map((llamada) => llamada[0] as string)
        .filter((aviso) => aviso.includes(MESSAGES.KAFKA.BACKLOG_SKIPPED));

    beforeEach(() => entorno.servicio.start());

    it('con la cola entera caducada se adelanta a la cabeza del topic', async () => {
        const consumidor = await entregar(50, 600);

        expect(consumidor.seek).toHaveBeenCalledWith({ topic: 'lecturas', partition: 0, offset: '2000' });
        // 2000 menos el desplazamiento del mensaje que se estaba leyendo.
        expect(omisiones()).toEqual([`450 ${MESSAGES.KAFKA.BACKLOG_SKIPPED}`]);
        expect(administradores).toHaveLength(1);
        expect(administradores[0].disconnect).toHaveBeenCalledOnce();
    });

    it('un descarte suelto no mueve nada: hace falta más de un minuto sin guardar', async () => {
        const consumidor = await entregar(49, 600);
        expect(consumidor.seek).not.toHaveBeenCalled();
        expect(administradores).toHaveLength(0);
    });

    it('un mensaje aprovechable reinicia la cuenta', async () => {
        await entregar(49, 600);
        await entregar(1, 0);
        const consumidor = await entregar(49, 600);

        expect(entorno.processor.processAndSave).toHaveBeenCalledOnce();
        expect(consumidor.seek).not.toHaveBeenCalled();
    });

    it('si tras adelantarse sigue leyendo cola vieja, vuelve a adelantarse', async () => {
        expect((await entregar(99, 600)).seek).toHaveBeenCalledOnce();
        expect((await entregar(1, 600)).seek).toHaveBeenCalledTimes(2);
    });

    it('mientras espera la respuesta del broker no lanza otra consulta', async () => {
        const { Kafka: fabrica } = await import('kafkajs');
        const cliente = (fabrica as unknown as Mock).mock.results[0].value as { admin: Mock };
        let responder: ((particiones: unknown) => void) | null = null;
        const admin = {
            connect: vi.fn(() => Promise.resolve()),
            fetchTopicOffsets: vi.fn(() => new Promise((resolver) => { responder = resolver; })),
            disconnect: vi.fn(() => Promise.resolve()),
        };
        cliente.admin.mockReturnValueOnce(admin);

        const enEspera = entregar(50, 600);
        await vi.waitFor(() => expect(admin.fetchTopicOffsets).toHaveBeenCalled());
        await entregar(50, 600);
        expect(cliente.admin).toHaveBeenCalledOnce();

        responder?.([{ partition: 0, high: '2000', low: '0' }]);
        await enEspera;
        expect(ultimo().seek).toHaveBeenCalledOnce();
    });

    it('si el broker no responde, lo registra y sigue consumiendo', async () => {
        const { Kafka: fabrica } = await import('kafkajs');
        const cliente = (fabrica as unknown as Mock).mock.results[0].value as { admin: Mock };
        cliente.admin.mockReturnValueOnce({
            connect: vi.fn(() => Promise.reject(new Error('sin broker'))),
            fetchTopicOffsets: vi.fn(),
            disconnect: vi.fn(),
        });

        const consumidor = await entregar(50, 600);

        expect(consumidor.seek).not.toHaveBeenCalled();
        expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.KAFKA.SEEK_ERROR, expect.any(Error));
        expect(entorno.servicio.running).toBe(true);
    });

    it('sin la partición que se está leyendo, avisa en lugar de saltar a ciegas', async () => {
        const { Kafka: fabrica } = await import('kafkajs');
        const cliente = (fabrica as unknown as Mock).mock.results[0].value as { admin: Mock };
        cliente.admin.mockReturnValueOnce({
            connect: vi.fn(() => Promise.resolve()),
            fetchTopicOffsets: vi.fn(() => Promise.resolve([{ partition: 3, high: '10', low: '0' }])),
            disconnect: vi.fn(() => Promise.resolve()),
        });

        const consumidor = await entregar(50, 600);

        expect(consumidor.seek).not.toHaveBeenCalled();
        expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.KAFKA.SEEK_ERROR, expect.any(Error));
    });

    it('tras detenerse no intenta adelantar nada', async () => {
        await entregar(49, 600);
        const consumidor = ultimo();
        await entorno.servicio.stop();
        await entregar(1, 600);

        expect(consumidor.seek).not.toHaveBeenCalled();
        expect(administradores).toHaveLength(0);
    });
});

describe('KafkaConsumerService: arranque con cola acumulada', () => {
    /** Programa la respuesta del siguiente cliente de administración. */
    const broker = async (vigentes: unknown[], confirmados: unknown[]) => {
        const { Kafka: fabrica } = await import('kafkajs');
        const cliente = (fabrica as unknown as Mock).mock.results[0].value as { admin: Mock };
        const admin = {
            connect: vi.fn(() => Promise.resolve()),
            fetchTopicOffsets: vi.fn(),
            fetchTopicOffsetsByTimestamp: vi.fn(() => Promise.resolve(vigentes)),
            fetchOffsets: vi.fn(() => Promise.resolve(confirmados)),
            disconnect: vi.fn(() => Promise.resolve()),
        };
        cliente.admin.mockReturnValueOnce(admin);
        return admin;
    };

    /** Une el consumidor al grupo con esas particiones y espera a que termine de revisar la cola. */
    const unirse = async (particiones: number[], admin: { disconnect: Mock }) => {
        ultimo().manejadores['consumer.group_join']({ payload: { groupId: 'grupo', memberAssignment: { lecturas: particiones } } });
        await vi.waitFor(() => expect(admin.disconnect).toHaveBeenCalled());
        await new Promise((resolver) => { setImmediate(resolver); });
    };

    /** Avisos de omisión al unirse. */
    const omisiones = () => entorno.logger.warn.mock.calls
        .map((llamada) => llamada[0] as string)
        .filter((aviso) => aviso.includes(MESSAGES.KAFKA.STALE_SKIPPED_ON_JOIN));

    beforeEach(() => entorno.servicio.start());

    it('salta hasta el primer mensaje dentro del límite de antigüedad, sin tener que usar el comando', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
        const admin = await broker([{ partition: 0, offset: '1900' }], [{ topic: 'lecturas', partitions: [{ partition: 0, offset: '1500' }] }]);

        await unirse([0], admin);

        // Un minuto antes de unirse; `waitFor` avanza el reloj falso unos milisegundos al esperar.
        const [topic, desde] = admin.fetchTopicOffsetsByTimestamp.mock.calls[0] as unknown as [string, number];
        expect(topic).toBe('lecturas');
        expect(desde - Date.parse('2026-09-26T11:59:00Z')).toBeGreaterThanOrEqual(0);
        expect(desde - Date.parse('2026-09-26T11:59:00Z')).toBeLessThan(1_000);
        expect(admin.fetchOffsets).toHaveBeenCalledWith({ groupId: 'grupo', topics: ['lecturas'] });
        expect(ultimo().seek).toHaveBeenCalledWith({ topic: 'lecturas', partition: 0, offset: '1900' });
        expect(omisiones()).toEqual([`400 ${MESSAGES.KAFKA.STALE_SKIPPED_ON_JOIN} (partición 0)`]);
    });

    it.each([
        ['el grupo va al día', [{ partition: 0, offset: '1900' }]],
        ['el grupo va por delante', [{ partition: 0, offset: '1950' }]],
        ['el grupo nunca confirmó nada', [{ partition: 0, offset: '-1' }]],
        ['la partición no figura en lo confirmado', []],
    ])('no retrocede ni toca nada si %s', async (_caso, particiones) => {
        const admin = await broker([{ partition: 0, offset: '1900' }], [{ topic: 'lecturas', partitions: particiones }]);
        await unirse([0], admin);
        expect(ultimo().seek).not.toHaveBeenCalled();
        expect(omisiones()).toEqual([]);
    });

    it('sin respuesta de lo confirmado no mueve nada', async () => {
        const admin = await broker([{ partition: 0, offset: '1900' }], []);
        await unirse([0], admin);
        expect(ultimo().seek).not.toHaveBeenCalled();
    });

    it('sólo mueve las particiones que le tocaron', async () => {
        const admin = await broker(
            [{ partition: 0, offset: '1900' }, { partition: 1, offset: '800' }],
            [{ topic: 'lecturas', partitions: [{ partition: 0, offset: '100' }, { partition: 1, offset: '700' }] }],
        );
        await unirse([1], admin);
        expect(ultimo().seek).toHaveBeenCalledOnce();
        expect(ultimo().seek).toHaveBeenCalledWith({ topic: 'lecturas', partition: 1, offset: '800' });
    });

    it('si el broker no responde, lo registra y sigue consumiendo', async () => {
        const { Kafka: fabrica } = await import('kafkajs');
        const cliente = (fabrica as unknown as Mock).mock.results[0].value as { admin: Mock };
        cliente.admin.mockReturnValueOnce({ connect: vi.fn(() => Promise.reject(new Error('sin broker'))), disconnect: vi.fn() });

        ultimo().manejadores['consumer.group_join']({ payload: { groupId: 'grupo', memberAssignment: { lecturas: [0] } } });

        await vi.waitFor(() => expect(entorno.logger.error).toHaveBeenCalledWith(MESSAGES.KAFKA.SEEK_ERROR, expect.any(Error)));
        expect(ultimo().seek).not.toHaveBeenCalled();
        expect(entorno.servicio.running).toBe(true);
    });
});
