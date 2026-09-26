import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/** Cliente de administración de kafkajs simulado, con lo que responde cada llamada. */
const { admin, Kafka } = vi.hoisted(() => {
    const cliente = {
        connect: vi.fn(() => Promise.resolve()),
        disconnect: vi.fn(() => Promise.resolve()),
        describeGroups: vi.fn(),
        fetchTopicOffsets: vi.fn(),
        fetchOffsets: vi.fn(),
        resetOffsets: vi.fn(() => Promise.resolve()),
    };

    /** Cliente de kafkajs simulado: siempre devuelve el mismo administrador. */
    class KafkaSimulado {
        /** Fábrica del cliente de administración. */
        admin = vi.fn(() => cliente);
    }

    return { admin: cliente, Kafka: vi.fn(KafkaSimulado) };
});
vi.mock('kafkajs', () => ({ Kafka }));

import { container } from 'tsyringe';
import { KafkaConfig } from '../../src/config/kafka.config';
import { atrasoPorParticion, principal as adelantar } from '../../src/scripts/adelantar-consumer';

const CFG = {
    brokers: ['broker:9093'],
    ssl: { rejectUnauthorized: true },
    topic: 'lecturas',
    groupId: 'heatmap-back',
    maxMessageAgeSeconds: 60,
};

let salida: string[];
let argvOriginal: string[];

/** Simula los argumentos con los que se lanzó el script. */
const conArgumentos = (...argumentos: string[]) => { process.argv = ['node', 'script', ...argumentos]; };

/** Deja el grupo con los miembros indicados y el atraso indicado. */
const conGrupo = ({ miembros = 1, cabeza = '2000', grupo = '1579' } = {}) => {
    admin.describeGroups.mockResolvedValue({
        groups: [{
            groupId: CFG.groupId,
            state: 'Stable',
            members: Array.from({ length: miembros }, (_valor, indice) => ({
                clientId: 'sensor-consumer',
                clientHost: `/10.0.0.${indice + 1}`,
            })),
        }],
    });
    admin.fetchTopicOffsets.mockResolvedValue([{ partition: 0, high: cabeza, low: '0' }]);
    admin.fetchOffsets.mockResolvedValue([{ topic: CFG.topic, partitions: [{ partition: 0, offset: grupo }] }]);
};

beforeEach(() => {
    salida = [];
    argvOriginal = process.argv;
    vi.spyOn(process.stdout, 'write').mockImplementation((texto) => { salida.push(String(texto)); return true; });
    container.registerInstance(KafkaConfig, CFG as never);
    process.exitCode = undefined;
    conArgumentos();
});

afterEach(() => {
    process.argv = argvOriginal;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.clearAllMocks();
    container.clearInstances();
});

describe('atrasoPorParticion', () => {
    it('resta el desplazamiento del grupo a la cabeza de cada partición', () => {
        expect(atrasoPorParticion(
            [{ partition: 0, high: '100' }, { partition: 1, high: '50' }],
            [{ partition: 0, offset: '80' }, { partition: 1, offset: '50' }],
        )).toEqual([
            { particion: 0, cabeza: 100, grupo: 80, atraso: 20 },
            { particion: 1, cabeza: 50, grupo: 50, atraso: 0 },
        ]);
    });

    it('un grupo que nunca confirmó un desplazamiento no está atrasado', () => {
        expect(atrasoPorParticion([{ partition: 0, high: '100' }], [{ partition: 0, offset: '-1' }]))
            .toEqual([{ particion: 0, cabeza: 100, grupo: null, atraso: 0 }]);
        expect(atrasoPorParticion([{ partition: 0, high: '100' }], []))
            .toEqual([{ particion: 0, cabeza: 100, grupo: null, atraso: 0 }]);
    });
});

describe('kafka:atraso', () => {
    it('rechaza una opción que no reconoce, sin tocar el broker', async () => {
        conArgumentos('--borrar-todo');
        await adelantar();
        expect(salida.join('')).toContain('Uso: npm run kafka:atraso');
        expect(process.exitCode).toBe(1);
        expect(Kafka).not.toHaveBeenCalled();
    });

    it('informa del grupo y del atraso sin mover nada', async () => {
        conGrupo();
        await adelantar();

        const texto = salida.join('');
        expect(Kafka).toHaveBeenCalledWith(expect.objectContaining({ brokers: CFG.brokers, ssl: CFG.ssl }));
        expect(texto).toContain('Grupo heatmap-back: estado Stable, 1 miembro(s)');
        expect(texto).toContain('partición 0: cabeza 2000, grupo 1579, atraso 421 mensajes');
        expect(texto).toContain('Lo salta solo al arrancar');
        expect(admin.resetOffsets).not.toHaveBeenCalled();
        expect(admin.disconnect).toHaveBeenCalledOnce();
    });

    it('avisa cuando hay dos consumidores peleándose por la partición', async () => {
        conGrupo({ miembros: 2 });
        await adelantar();
        expect(salida.join('')).toContain('Hay más de un consumidor en el grupo');
    });

    it('sin atraso no sugiere nada', async () => {
        conGrupo({ cabeza: '2000', grupo: '2000' });
        await adelantar();
        expect(salida.join('')).not.toContain('Lo salta solo');
    });

    it('--mover con el grupo parado lo lleva a la cabeza del topic', async () => {
        conGrupo({ miembros: 0 });
        conArgumentos('--mover');

        await adelantar();

        expect(admin.resetOffsets).toHaveBeenCalledWith({ groupId: CFG.groupId, topic: CFG.topic, earliest: false });
        expect(salida.join('')).toContain('Desplazamiento movido a la cabeza del topic');
        expect(process.exitCode).toBeUndefined();
    });

    it('--mover con el grupo en marcha no escribe y explica por qué', async () => {
        conGrupo({ miembros: 1 });
        conArgumentos('--mover');

        await adelantar();

        expect(admin.resetOffsets).not.toHaveBeenCalled();
        expect(salida.join('')).toContain('miembros activos');
        expect(process.exitCode).toBe(1);
    });

    it('cierra la conexión aunque el broker falle', async () => {
        admin.describeGroups.mockRejectedValue(new Error('sin broker'));
        await expect(adelantar()).rejects.toThrow('sin broker');
        expect(admin.disconnect).toHaveBeenCalledOnce();
    });
});

describe('kafka:atraso como programa', () => {
    it('registra el fallo y termina con código 1', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        admin.connect.mockRejectedValueOnce(new Error('TLS rechazado'));

        await adelantar().catch((err: unknown) => {
            process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
            process.exitCode = 1;
        });

        expect((stderr as unknown as Mock).mock.calls[0][0]).toContain('TLS rechazado');
        expect(process.exitCode).toBe(1);
    });
});
