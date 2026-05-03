import { ProcessedSensorData } from '../types/sensor.types';
import logger from '../utils/logger';

class DataProcessorService {
    /**
     * Procesa los datos recibidos de Kafka antes de guardarlos en la base de datos
     * 
     * IMPLEMENTA AQUÍ TU LÓGICA DE PROCESAMIENTO
     * 
     * Ejemplos de procesamiento:
     * - Filtrar dispositivos por RSSI
     * - Agrupar dispositivos por ubicación
     * - Calcular promedios o estadísticas
     * - Detectar patrones de movimiento
     * - Identificar anomalías
     * 
     * @param data - Datos procesados del sensor
     */
    async processAndSave(data: ProcessedSensorData): Promise<void> {
        logger.debug('Procesando datos del sensor...');

        // TODO: Implementa aquí la lógica de procesamiento y guardado
        // Ejemplo:
        // const filteredDevices = data.devices.filter(d => d.rssi > -70);
        // await this.saveToDatabase(filteredDevices);

        logger.debug('Procesamiento completado');
    }
}

export default new DataProcessorService();
