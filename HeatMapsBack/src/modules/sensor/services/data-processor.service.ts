import { singleton } from 'tsyringe';
import { LoggerService } from '../../../common/logger/logger.service';
import { ProcessedSensorData } from '../../../types/sensor.types';
import { CapturaInsert, CapturaRepository } from '../repositories/captura.repository';
import { SensorRepository } from '../repositories/sensor.repository';
import { ZonaRepository } from '../repositories/zona.repository';
import { DistanceEstimatorService } from './distance-estimator.service';
import { MacAnonymizerService } from './mac-anonymizer.service';

/** Canal Wi-Fi por defecto cuando el sensor no lo reporta. */
const UNKNOWN_CHANNEL = 0;

/**
 * Persiste las lecturas que llegan por Kafka.
 *
 * Por cada lectura:
 *  1. Garantiza que el nodo emisor esté registrado (auto-provisión en la zona
 *     «Sin asignar» si es la primera vez que se le ve).
 *  2. Anonimiza cada MAC con HMAC antes de tocar la base de datos.
 *  3. Estima la distancia desde el RSSI con el modelo logarítmico.
 *  4. Inserta el lote completo de detecciones.
 *
 * La agregación por zona **no** ocurre aquí: la hace `OccupancyAggregatorService`
 * en ventanas cerradas. Mezclar ambas cosas obligaría a recalcular la ventana
 * en cada mensaje, que es justo lo que la tabla agregada existe para evitar.
 *
 * Alcance único: la caché de nodos conocidos solo evita consultas si sobrevive
 * entre mensajes, cosa que con alcance transitorio no ocurre.
 */
@singleton()
export class DataProcessorService {
    /**
     * Cache de nodos ya vistos en este proceso. Evita una consulta de
     * existencia por cada mensaje: un nodo que emite cada pocos segundos
     * generaría miles de SELECT redundantes al día.
     */
    private readonly knownSensors = new Set<string>();

    constructor(
        private readonly capturas: CapturaRepository,
        private readonly sensores: SensorRepository,
        private readonly zonas: ZonaRepository,
        private readonly anonymizer: MacAnonymizerService,
        private readonly distance: DistanceEstimatorService,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Procesa y persiste un payload ya descifrado y normalizado.
     *
     * La marca de aleatorización se recalcula a partir del bit U/L en lugar de
     * copiar la que envía el nodo: el estándar IEEE 802 es la fuente normativa
     * y el resultado no debe depender de que el productor la haya interpretado
     * bien.
     *
     * Los errores se propagan al consumidor de Kafka, que los captura por
     * mensaje: una lectura mal formada no debe tumbar el consumer ni impedir
     * que se emita por WebSocket.
     *
     * @param data - Lectura de un nodo lista para persistir.
     */
    async processAndSave(data: ProcessedSensorData): Promise<void> {
        if (data.devices.length === 0) {
            this.logger.debug(`Lectura sin dispositivos, sensor=${data.sensor_id}`);
            return;
        }

        const seenAt = new Date(data.timestamp_raw * 1000);
        await this.ensureSensorRegistered(data.sensor_id, seenAt);

        const rows: CapturaInsert[] = data.devices.map((device) => ({
            macHash: this.anonymizer.hash(device.mac),
            idSensor: data.sensor_id,
            rssi: Math.trunc(device.rssi),
            distanciaEstimada: this.distance.estimate(device.rssi),
            canal: Number(device.channel) || UNKNOWN_CHANNEL,
            tipoTrama: (device.type || 'desconocido').slice(0, 20),
            esMacRandom: this.anonymizer.isRandomized(device.mac),
            timestampCaptura: seenAt,
        }));

        const inserted = await this.capturas.insertMany(rows);
        this.logger.debug(`Persistidas ${inserted} detecciones de sensor=${data.sensor_id}`);
    }

    /**
     * Registra el nodo si es la primera vez que publica y actualiza su marca
     * de última conexión.
     */
    private async ensureSensorRegistered(idSensor: string, seenAt: Date): Promise<void> {
        if (!this.knownSensors.has(idSensor)) {
            const existing = await this.sensores.findById(idSensor);
            if (!existing) {
                const zona = await this.zonas.findOrCreateDefault();
                await this.sensores.create(idSensor, zona.idZona);
                this.logger.info(
                    `Nodo de captura ${idSensor} registrado automáticamente en la zona «${zona.nombre}»`,
                );
            }
            this.knownSensors.add(idSensor);
        }
        await this.sensores.touch(idSensor, seenAt);
    }
}
