import { singleton } from 'tsyringe';
import { LoggerService } from '../../common/logger/logger.service';
import { LecturaSensor } from '../../types/sensor.types';
import { CapturaInsert, CapturaRepository } from '../../persistencia/repositorios/captura.repository';
import { SensorRepository } from '../../persistencia/repositorios/sensor.repository';
import { ZonaRepository } from '../../persistencia/repositorios/zona.repository';
import { DistanceEstimatorService } from '../procesamiento/distance-estimator.service';
import { PresenciaService } from '../procesamiento/presencia.service';
import { detectarInfraestructura } from '../procesamiento/presencia';
import { MacAnonymizerService } from '../anonimizacion/mac-anonymizer.service';
import { filtrarMacs, totalDescartes } from './filtro-mac';

/**
 * Intervalo mínimo entre dos actualizaciones de la última conexión de un nodo.
 *
 * Un nodo publica cada pocos segundos y escribir la marca en cada mensaje
 * añadía una consulta por lectura, justo en el camino que tiene que seguir el
 * ritmo de los nodos. El panel considera caído un nodo tras 3 minutos, así que
 * 30 s de resolución sobran.
 */
const TOQUE_MINIMO_MS = 30_000;

/**
 * Lleva una lectura validada por las etapas del diagrama de secuencia hasta la
 * base de datos: filtrado MAC → anonimización → procesamiento → persistencia.
 *
 * Por cada lectura:
 *  1. Depura las MAC mal formadas, de grupo y duplicadas (`filtrarMacs`, RF-11).
 *  2. Garantiza que el nodo emisor esté registrado (auto-provisión en la zona
 *     «Sin asignar» si es la primera vez que se le ve).
 *  3. Anonimiza cada MAC con HMAC antes de tocar la base de datos (RF-02).
 *  4. Estima la distancia desde el RSSI con el modelo logarítmico.
 *  5. Inserta el lote completo de detecciones.
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

    /** Última actualización de `ultimaConexion` de cada nodo, en milisegundos. */
    private readonly ultimoToque = new Map<string, number>();

    constructor(
        private readonly capturas: CapturaRepository,
        private readonly sensores: SensorRepository,
        private readonly zonas: ZonaRepository,
        private readonly anonymizer: MacAnonymizerService,
        private readonly distance: DistanceEstimatorService,
        private readonly presencia: PresenciaService,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Procesa y persiste un payload ya descifrado y normalizado.
     *
     * Aquí se detecta también la infraestructura: es el único punto por el que
     * pasa la MAC en claro, y sin ella no se ve que varios BSSID son del mismo
     * punto de acceso.
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
     * @param lectura - Lectura de un nodo, ya validada.
     * @returns Dispositivos guardados, tras el filtrado.
     */
    async processAndSave(lectura: LecturaSensor): Promise<number> {
        const { dispositivos, descartes } = filtrarMacs(lectura.dispositivos);
        if (totalDescartes(descartes) > 0) {
            this.logger.debug(
                `Filtrado MAC, sensor=${lectura.sensorId}: ${descartes.malformadas} mal formadas, `
                + `${descartes.deGrupo} de grupo, ${descartes.duplicadas} duplicadas`,
            );
        }
        if (dispositivos.length === 0) {
            this.logger.debug(`Lectura sin dispositivos, sensor=${lectura.sensorId}`);
            return 0;
        }

        const seenAt = new Date(lectura.timestamp * 1000);
        await this.ensureSensorRegistered(lectura.sensorId, seenAt);

        const rows: CapturaInsert[] = dispositivos.map((dispositivo) => ({
            macHash: this.anonymizer.hash(dispositivo.mac),
            idSensor: lectura.sensorId,
            rssi: dispositivo.rssi,
            distanciaEstimada: this.distance.estimate(dispositivo.rssi),
            canal: dispositivo.canal,
            tipoTrama: dispositivo.tipoTrama,
            esMacRandom: this.anonymizer.isRandomized(dispositivo.mac),
            timestampCaptura: seenAt,
        }));

        const infraestructura = [...detectarInfraestructura(dispositivos)]
            .map(([mac, motivo]) => ({ macHash: this.anonymizer.hash(mac), motivo }));

        // Las dos escrituras son independientes y van a la vez: con la base al
        // otro lado de una red lenta, cada ida y vuelta cuenta, y este camino
        // tiene que seguir el ritmo de los nodos. `anotarInfraestructura` no
        // lanza nunca, así que un fallo sólo puede venir de la inserción.
        const [inserted] = await Promise.all([
            this.capturas.insertMany(rows),
            this.presencia.anotarInfraestructura(infraestructura, seenAt),
        ]);
        this.logger.debug(`Persistidas ${inserted} detecciones de sensor=${lectura.sensorId}`);
        return dispositivos.length;
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
        const ahora = Date.now();
        if (ahora - (this.ultimoToque.get(idSensor) ?? 0) < TOQUE_MINIMO_MS) return;
        this.ultimoToque.set(idSensor, ahora);
        await this.sensores.touch(idSensor, seenAt);
    }
}
