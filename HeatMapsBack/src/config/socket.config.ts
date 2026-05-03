import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import logger from '../utils/logger';
import { MESSAGES } from '../constants/messages';

let io: SocketIOServer | null = null;

export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
    const corsOrigin = process.env.CORS_ORIGIN || '*';

    io = new SocketIOServer(httpServer, {
        cors: {
            origin: corsOrigin,
            methods: ['GET', 'POST']
        }
    });

    io.on('connection', (socket) => {
        logger.info(`${MESSAGES.WEBSOCKET.CLIENT_CONNECTED}: ${socket.id}`);

        socket.on('disconnect', () => {
            logger.info(`${MESSAGES.WEBSOCKET.CLIENT_DISCONNECTED}: ${socket.id}`);
        });

        socket.emit('connected', {
            message: MESSAGES.WEBSOCKET.WELCOME,
            timestamp: new Date().toISOString()
        });
    });

    return io;
}

export function getSocketIO(): SocketIOServer {
    if (!io) throw new Error('Socket.IO no ha sido inicializado');
    return io;
}

export function emitSensorData(data: any): void {
    if (io) {
        io.emit('sensor-data', data);
    }
}
