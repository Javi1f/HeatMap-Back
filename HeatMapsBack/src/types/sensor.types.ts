/**
 * Tipos de dominio de la ingesta de lecturas Wi-Fi.
 *
 * Siguen las etapas del diagrama de secuencia: lo que llega del nodo no tiene
 * tipo hasta que la validación (`ingesta/validacion-lectura.ts`) lo convierte
 * en una {@link LecturaSensor}; el filtrado de MAC la depura; la anonimización
 * sustituye la MAC por su hash al guardar; y a tiempo real solo sale un
 * {@link ResumenSensor}.
 */

/**
 * Dispositivo de una lectura, ya validado.
 *
 * Solo conserva lo que el sistema usa (RNF-01, minimización): el resto de
 * campos que envía el productor no pasa de la validación.
 */
export interface DispositivoDetectado {
    /** Dirección MAC en claro. Nunca se almacena: se anonimiza al guardar. */
    mac: string;

    /** Intensidad de señal recibida, en dBm. */
    rssi: number;

    /** Canal Wi-Fi en el que se vio; 0 si no se conoce. */
    canal: number;

    /** Tipo de trama o estado del dispositivo (`probing`, `associated`...). */
    tipoTrama: string;
}

/** Lectura de un nodo tras validar su estructura. */
export interface LecturaSensor {
    /** Nodo que emitió la lectura (`sensor.id_sensor`). */
    sensorId: string;

    /** Momento de la lectura, en segundos desde epoch. */
    timestamp: number;

    /** Dispositivos válidos de la lectura. */
    dispositivos: DispositivoDetectado[];
}

/**
 * Resumen de una lectura, que es lo único que se difunde por WebSocket.
 *
 * El canal de Socket.IO no exige autenticación: cualquiera que abra una
 * conexión recibe lo que se emita. Por eso se difunde solo el conteo y la hora,
 * nunca la lista de dispositivos ni el identificador del nodo: es la misma
 * regla que sigue la API pública (`/api/publico`), que tampoco expone
 * identificadores de infraestructura.
 */
export interface ResumenSensor {
    /** Dispositivos que pasaron la validación y el filtrado. */
    total_devices: number;

    /** Hora local legible de la lectura. */
    timestamp: string;

    /** Momento en que el backend la recibió, en ISO. */
    received_at: string;
}
