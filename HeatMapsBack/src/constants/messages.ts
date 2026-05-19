/**
 * Mensajes de log y respuesta agrupados por dominio.
 *
 * Centralizar aquí los strings evita "magic strings" diseminados y facilita
 * un futuro paso a i18n.
 */
export const MESSAGES = {
    CONSUMER: {
        ALREADY_RUNNING: 'Consumer ya está ejecutándose',
        NOT_RUNNING: 'Consumer no está ejecutándose',
        STARTED: 'Consumer iniciado correctamente',
        STOPPED: 'Consumer detenido correctamente',
        START_ERROR: 'Error al iniciar consumer',
        STOP_ERROR: 'Error al detener consumer',
    },
    SERVER: {
        STARTED: 'Servidor iniciado en puerto',
        CONSUMER_STARTED: 'Kafka Consumer iniciado',
        START_ERROR: 'Error al iniciar consumer',
    },
    WEBSOCKET: {
        CLIENT_CONNECTED: 'Cliente conectado',
        CLIENT_DISCONNECTED: 'Cliente desconectado',
        WELCOME: 'Conectado al servidor de sensores WiFi',
    },
    KAFKA: {
        DATA_RECEIVED: 'Datos recibidos',
        DATA_SENT: 'Datos enviados por WebSocket',
        DECRYPT_ERROR: 'Error al descifrar mensaje',
        EMPTY_MESSAGE: 'Mensaje vacío recibido',
    },
} as const;
