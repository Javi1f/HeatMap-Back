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
        CRASHED: 'El consumer de Kafka se detuvo',
        RESTARTING: 'Reintentando iniciar el consumer en',
        GROUP_JOINED: 'Consumer unido al grupo',
        NO_PARTITIONS:
            'Consumer unido al grupo sin particiones: otra instancia del mismo grupo las está leyendo',
        INCOMPATIBLE_GROUP:
            'Otro cliente del grupo usa un asignador de particiones distinto (por ejemplo kafka-python con "range") '
            + 'y el broker no admite a este consumer. Configura un KAFKA_GROUP_ID exclusivo para el backend.',
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
