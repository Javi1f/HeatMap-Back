import { injectable } from 'tsyringe';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData } from '../../../types/sensor.types';

/**
 * Servicio encargado de procesar y persistir los datos crudos recibidos
 * desde Kafka.
 *
 * **Estado actual**: skeleton. La lógica de triangulación y persistencia
 * se implementará en una iteración futura. Hoy solo loguea la recepción
 * para mantener trazabilidad en producción mientras el procesador real
 * se desarrolla.
 *
 * **Responsabilidades futuras**:
 *  1. Triangular dispositivos a partir de las lecturas RSSI de varios
 *     sensores (requiere coordenadas conocidas de los sensores).
 *  2. Almacenar lecturas crudas en una entidad `SensorReading` para
 *     análisis histórico.
 *  3. Calcular agregados (densidad, dispositivos únicos) para los
 *     dashboards de "Históricos e Información".
 *
 * **Patrón a seguir cuando se implemente**:
 *  - Recibir un repositorio inyectado (`SensorReadingRepository`).
 *  - Encapsular el algoritmo de triangulación en una clase aparte
 *    (`Triangulation`) testeable de forma aislada.
 *  - Devolver el resultado al `KafkaConsumerService` para que este decida
 *    qué emitir por WebSocket.
 */
@injectable()
export class DataProcessorService {
    constructor(private readonly logger: LoggerService) {}

    /**
     * Procesa y persiste un payload ya descifrado y normalizado.
     *
     * @param data - Datos del sensor listos para procesar.
     */
    processAndSave(data: ProcessedSensorData): Promise<void> {
        // TODO(triangulation): implementar algoritmo de triangulación.
        // TODO(persistence): guardar lectura cruda en BD.
        this.logger.debug(
            `processAndSave sensor=${data.sensor_id} devices=${data.total_devices}`,
        );
        return Promise.resolve();
    }
}
