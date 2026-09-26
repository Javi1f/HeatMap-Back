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
        CONSUMER_DISABLED: 'Ingesta de Kafka desactivada (KAFKA_CONSUMER_ENABLED=false): '
            + 'otra instancia guarda las capturas y esta sirve lo que hay en la base',
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
        INVALID_PAYLOAD: 'Lectura descartada por estructura inválida',
        INVALID_DEVICES: 'dispositivos descartados por datos inválidos',
        PROCESS_ERROR: 'Error al procesar y guardar una lectura',
        EMPTY_MESSAGE: 'Mensaje vacío recibido',
        STALE_DISCARDED:
            'mensajes descartados por antiguos. Si se repite, el consumer va atrasado y no se guardan '
            + 'capturas: comprueba qué instancia del grupo tiene la partición y si da abasto.',
        BACKLOG_SKIPPED:
            'mensajes de la cola omitidos. Todos eran anteriores al límite, así que el consumer se '
            + 'adelantó a la cabeza del topic para volver a guardar capturas en tiempo real.',
        STALE_SKIPPED_ON_JOIN:
            'mensajes caducados omitidos al unirse al grupo: la cola que se acumuló con el backend '
            + 'parado ya superaba el límite de antigüedad.',
        SEEK_ERROR: 'No se pudo adelantar el consumer en el topic',
    },
} as const;
