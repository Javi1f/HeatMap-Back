import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/** Servidor de Socket.IO simulado. */
interface ServidorFalso {
    /** Servidor HTTP recibido. */
    http: unknown;
    /** Opciones de creación. */
    opciones: unknown;
    /** Manejadores registrados, por evento. */
    manejadores: Record<string, (socket: unknown) => void>;
    /** Registro de manejadores. */
    on: Mock;
    /** Difusión a todos los clientes. */
    emit: Mock;
    /** Cierre del servidor. */
    close: Mock;
}

/** Servidor de Socket.IO simulado que guarda sus manejadores y emisiones. */
const { servidores, Server } = vi.hoisted(() => {
    const creados: ServidorFalso[] = [];

    /** Servidor simulado: registra lo que recibe y se guarda para inspeccionarlo. */
    class ServidorSimulado implements ServidorFalso {
        /** Servidor HTTP recibido. */
        http: unknown;
        /** Opciones de creación. */
        opciones: unknown;
        /** Manejadores registrados, por evento. */
        manejadores: Record<string, (socket: unknown) => void> = {};
        /** Registro de manejadores. */
        on = vi.fn((evento: string, fn: (socket: unknown) => void) => { this.manejadores[evento] = fn; });
        /** Difusión a todos los clientes. */
        emit = vi.fn();
        /** Cierre del servidor. */
        close = vi.fn((alCerrar: () => void) => alCerrar());

        /** Guarda los argumentos con los que el servicio crea el servidor. */
        constructor(http: unknown, opciones: unknown) {
            this.http = http;
            this.opciones = opciones;
            creados.push(this);
        }
    }

    return { servidores: creados, Server: vi.fn(ServidorSimulado) };
});
vi.mock('socket.io', () => ({ Server }));

import { container } from 'tsyringe';
import { SocketEmitterService } from '../../../src/modules/tiempo-real/socket-emitter.service';
import { ApiPayloadCipher } from '../../../src/crypto/api-payload.crypto';
import { MESSAGES } from '../../../src/constants/messages';
import { loggerFalso } from '../../helpers/dobles';

const cifrador = container.resolve(ApiPayloadCipher);
const cfg = { corsOrigin: 'https://front.test', corsMethods: ['GET', 'POST'] };
const resumen = { total_devices: 2, timestamp: '12:00:00', received_at: '2026-09-14T12:00:00.000Z' };

let logger: ReturnType<typeof loggerFalso>;
let servicio: SocketEmitterService;
beforeEach(() => {
    servidores.length = 0;
    Server.mockClear();
    logger = loggerFalso();
    servicio = new SocketEmitterService(cfg as never, cifrador, logger);
});

describe('SocketEmitterService', () => {
    it('descarta eventos antes de inicializar', () => {
        servicio.emitSensorData(resumen);
        expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('crea un único servidor con el CORS configurado', () => {
        const http = {};
        const primero = servicio.initialize(http as never);
        const segundo = servicio.initialize(http as never);
        expect(primero).toBe(segundo);
        expect(Server).toHaveBeenCalledTimes(1);
        expect(servidores[0].opciones).toEqual({ cors: { origin: 'https://front.test', methods: ['GET', 'POST'] } });
    });

    it('saluda cifrado a cada cliente y registra conexión y desconexión', () => {
        servicio.initialize({} as never);
        const socketManejadores: Record<string, () => void> = {};
        const socket = { id: 's1', on: vi.fn((nombre: string, fn: () => void) => { socketManejadores[nombre] = fn; }), emit: vi.fn() };

        servidores[0].manejadores.connection(socket);
        socketManejadores.disconnect();

        const [evento, sobre] = socket.emit.mock.calls[0];
        expect(evento).toBe('connected');
        expect(cifrador.decrypt(sobre.data)).toMatchObject({ message: MESSAGES.WEBSOCKET.WELCOME });
        expect(logger.info).toHaveBeenCalledWith(`${MESSAGES.WEBSOCKET.CLIENT_CONNECTED}: s1`);
        expect(logger.info).toHaveBeenCalledWith(`${MESSAGES.WEBSOCKET.CLIENT_DISCONNECTED}: s1`);
    });

    it('difunde el resumen cifrado, sin identificadores de nodo ni de dispositivo', () => {
        servicio.initialize({} as never);
        servicio.emitSensorData(resumen);

        const [evento, sobre] = servidores[0].emit.mock.calls[0];
        expect(evento).toBe('sensor-data');
        expect(Object.keys(sobre)).toEqual(['data']);
        expect(cifrador.decrypt(sobre.data)).toEqual(resumen);
    });

    it('cierra de forma idempotente y permite volver a inicializar', async () => {
        await servicio.close();
        servicio.initialize({} as never);
        await servicio.close();
        expect(servidores[0].close).toHaveBeenCalledOnce();
        servicio.initialize({} as never);
        expect(Server).toHaveBeenCalledTimes(2);
    });
});
