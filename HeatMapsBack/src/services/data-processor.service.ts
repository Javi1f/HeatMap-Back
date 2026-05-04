import { ProcessedSensorData } from '../types/sensor.types';
import logger from '../utils/logger';

class DataProcessorService {

    async processAndSave(data: ProcessedSensorData): Promise<void> {
        logger.debug('Procesando datos del sensor...');


        logger.debug('Procesamiento completado');
    }
}

export default new DataProcessorService();
