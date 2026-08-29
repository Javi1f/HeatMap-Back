/**
 * Tipos de dominio para sensores WiFi.
 *
 * Representan los formatos de mensaje del productor (sensor físico)
 * y la versión normalizada que circula dentro del backend.
 */

/**
 * Dispositivo detectado por un sensor en una lectura.
 */
export interface Device {
    /** Dirección MAC del dispositivo (puede ser randomizada). */
    mac: string;
    /** Intensidad de señal recibida en dBm. */
    rssi: number;
    /** Canal WiFi en el que se vio. */
    channel: string | number;
    /** Tipo de trama detectada (probe, beacon, etc.). */
    type: string;
    /** Número de paquetes vistos durante la ventana. */
    packets: number;
    /** Timestamp en formato legible del último paquete. */
    last_seen: string;
    /** `true` si la MAC parece randomizada (bit local). */
    randomized: boolean;
}

/**
 * Payload tal como lo emite el sensor (productor Kafka), antes de
 * cualquier procesamiento.
 */
export interface SensorPayload {
    /** Identificador del nodo que emite la lectura. */
    sensor_id: string;

    /** Dispositivos incluidos en la lectura, segun el propio nodo. */
    total_devices: number;

    /** Epoch en segundos. */
    timestamp: number;

    /** Dispositivos detectados en la ventana. */
    devices: Device[];
}

/**
 * Versión normalizada del payload usada internamente por el backend
 * y difundida a los clientes WebSocket.
 */
export interface ProcessedSensorData {
    /** Identificador del nodo que emitio la lectura. */
    sensor_id: string;

    /** Dispositivos incluidos en la lectura. */
    total_devices: number;

    /** Hora local legible (ej. "12:34:56"). */
    timestamp: string;
    /** Epoch original en segundos (para deduplicación o trazabilidad). */
    timestamp_raw: number;
    /** Bytes recibidos desde Kafka (incluye cifrado, métrica de tráfico). */
    bytes_received: number;

    /** Dispositivos detectados en la ventana. */
    devices: Device[];
    /** ISO timestamp del momento en que el backend recibió el mensaje. */
    received_at: string;
}

/**
 * Resumen de una lectura, que es lo único que se difunde por WebSocket.
 *
 * El canal de Socket.IO no exige autenticación: cualquiera que abra una
 * conexión recibe lo que se emita. Por eso se difunde el conteo y nunca
 * `devices`, que contiene la dirección de cada dispositivo detectado.
 * Publicarlo permitiría a cualquiera seguir a una persona por el campus, que es
 * justo lo que el sistema se compromete a impedir.
 */
export interface ResumenSensor {
    /** Nodo que emitió la lectura. */
    sensor_id: string;

    /** Dispositivos detectados en la lectura. */
    total_devices: number;

    /** Hora local legible de la lectura. */
    timestamp: string;

    /** Momento en que el backend la recibió, en ISO. */
    received_at: string;
}
