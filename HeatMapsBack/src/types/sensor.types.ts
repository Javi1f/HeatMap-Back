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
    sensor_id: string;
    total_devices: number;
    /** Epoch en segundos. */
    timestamp: number;
    devices: Device[];
}

/**
 * Versión normalizada del payload usada internamente por el backend
 * y difundida a los clientes WebSocket.
 */
export interface ProcessedSensorData {
    sensor_id: string;
    total_devices: number;
    /** Hora local legible (ej. "12:34:56"). */
    timestamp: string;
    /** Epoch original en segundos (para deduplicación o trazabilidad). */
    timestamp_raw: number;
    /** Bytes recibidos desde Kafka (incluye cifrado, métrica de tráfico). */
    bytes_received: number;
    devices: Device[];
    /** ISO timestamp del momento en que el backend recibió el mensaje. */
    received_at: string;
}
