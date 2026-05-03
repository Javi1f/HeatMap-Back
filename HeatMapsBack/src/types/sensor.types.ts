export interface Device {
    mac: string;
    rssi: number;
    channel: string | number;
    type: string;
    packets: number;
    last_seen: string;
    randomized: boolean;
}

export interface SensorPayload {
    sensor_id: string;
    total_devices: number;
    timestamp: number;
    devices: Device[];
}

export interface KafkaSSLConfig {
    ssl: {
        rejectUnauthorized: boolean;
        ca: string[];
        cert: string[];
        key: string[];
    };
}

export interface ProcessedSensorData {
    sensor_id: string;
    total_devices: number;
    timestamp: string;
    timestamp_raw: number;
    bytes_received: number;
    devices: Device[];
    received_at: string;
}
