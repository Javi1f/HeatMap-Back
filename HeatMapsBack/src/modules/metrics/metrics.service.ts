import { injectable } from 'tsyringe';
import { SensingConfig } from '../../config/sensing.config';
import { Alerta } from '../../models/Alerta.entity';
import { NotFoundError } from '../../common/errors';
import { AlertaRepository } from '../sensor/repositories/alerta.repository';
import { CapturaRepository } from '../sensor/repositories/captura.repository';
import { OcupacionRepository } from '../sensor/repositories/ocupacion.repository';
import { SensorRepository } from '../sensor/repositories/sensor.repository';
import { ZonaRepository } from '../sensor/repositories/zona.repository';
import { resumirPresentes } from '../sensor/services/presencia';
import { PresenciaService } from '../sensor/services/presencia.service';
import { crearCacheTemporal } from '../../common/utils/cache-temporal';
import {
    MetricsOverview,
    OccupancyPoint,
    SensorHealth,
    ZoneOccupancy,
} from './metrics.types';

/**
 * Un nodo se considera en línea si emitió dentro de este margen. Es holgado a
 * propósito: los nodos publican por lotes y una pausa de un minuto es normal.
 */
const SENSOR_ONLINE_WINDOW_MINUTES = 3;

/** Ventana por defecto para los indicadores de «ahora mismo». */
const LIVE_WINDOW_MINUTES = 5;

/** Resumen reciente del panel, compartido entre peticiones (ver `mapasRecientes`). */
const resumenReciente = crearCacheTemporal<MetricsOverview>(1_000);

/** Tope de horas que se pueden pedir en una serie temporal. */
const MAX_SERIES_HOURS = 168;

/**
 * Lecturas agregadas para el panel de administración.
 *
 * Solo lee: ninguna de estas operaciones escribe, salvo la resolución de
 * alertas, que es la única acción que el responsable institucional ejecuta
 * desde el dashboard.
 */
@injectable()
export class MetricsService {
    constructor(
        private readonly capturas: CapturaRepository,
        private readonly presencia: PresenciaService,
        private readonly ocupacion: OcupacionRepository,
        private readonly sensores: SensorRepository,
        private readonly zonas: ZonaRepository,
        private readonly alertas: AlertaRepository,
        private readonly cfg: SensingConfig,
    ) {}

    /**
     * Tarjetas de cabecera: estado inmediato del sistema.
     *
     * Las cifras de dispositivos cuentan sólo a los presentes en alguna zona;
     * `detecciones` sigue contando todas las tramas, porque mide el trabajo de
     * la red de nodos y no la ocupación.
     */
    overview(): Promise<MetricsOverview> {
        return resumenReciente.obtener('resumen', () => this.calcularResumen());
    }

    /** Calcula el resumen sin pasar por la caché. */
    private async calcularResumen(): Promise<MetricsOverview> {
        const since = new Date(Date.now() - LIVE_WINDOW_MINUTES * 60_000);

        const [evaluaciones, detecciones, zonas, sensores, alertasAbiertas] = await Promise.all([
            this.presencia.evaluar(since, new Date()),
            this.capturas.deteccionesDesde(since),
            this.zonas.findActive(),
            this.sensores.findAll(),
            this.alertas.countUnresolved(),
        ]);

        const onlineThreshold = Date.now() - SENSOR_ONLINE_WINDOW_MINUTES * 60_000;
        const sensoresEnLinea = sensores.filter(
            (sensor) => sensor.ultimaConexion !== null && sensor.ultimaConexion.getTime() >= onlineThreshold,
        ).length;

        const presentes = resumirPresentes(...[...evaluaciones.values()].map((evaluacion) => evaluacion.presentes));

        return {
            dispositivosAhora: presentes.dispositivos,
            detecciones,
            porcentajeRandomizadas:
                presentes.dispositivos === 0
                    ? 0
                    : Math.round((presentes.aleatorias / presentes.dispositivos) * 1000) / 10,
            rssiPromedio: presentes.rssiMedio === null ? null : Math.round(presentes.rssiMedio * 10) / 10,
            zonasActivas: zonas.length,
            sensoresTotal: sensores.length,
            sensoresEnLinea,
            alertasAbiertas,
            ventanaMinutos: LIVE_WINDOW_MINUTES,
        };
    }

    /**
     * Ocupación actual de cada zona, tomada de su última ventana consolidada.
     *
     * Las zonas sin ninguna consolidación todavía aparecen igualmente, en cero:
     * que una zona no tenga datos es información relevante para el
     * administrador, no un motivo para ocultarla.
     */
    async zones(): Promise<ZoneOccupancy[]> {
        const [zonas, ultimas] = await Promise.all([
            this.zonas.findActive(),
            this.ocupacion.findLatestPerZone(),
        ]);

        const porZona = new Map(ultimas.map((ocupacion) => [ocupacion.idZona, ocupacion]));

        return zonas.map((zona) => {
            const ultima = porZona.get(zona.idZona);
            const unicos = ultima?.dispositivosUnicos ?? 0;

            return {
                idZona: zona.idZona,
                nombre: zona.nombre,
                capacidadMax: zona.capacidadMax,
                dispositivosUnicos: unicos,
                dispositivosEstables: ultima?.dispositivosEstables ?? 0,
                rssiPromedio: ultima?.rssiPromedio ?? null,
                nivelOcupacion: ultima?.nivelOcupacion ?? 'baja',
                porcentajeAforo: zona.capacidadMax
                    ? Math.round((unicos / zona.capacidadMax) * 1000) / 10
                    : null,
                actualizadoEn: ultima?.intervaloFin.toISOString() ?? null,
            };
        });
    }

    /**
     * Serie temporal de ocupación para las gráficas.
     *
     * @param hours  - Horas hacia atrás. Se recorta a {@link MAX_SERIES_HOURS}.
     * @param idZona - Filtra por zona; sin él devuelve todas.
     */
    async occupancySeries(hours: number, idZona?: string): Promise<OccupancyPoint[]> {
        const clamped = Math.min(Math.max(hours, 1), MAX_SERIES_HOURS);
        const since = new Date(Date.now() - clamped * 3_600_000);
        const rows = await this.ocupacion.findSeries(since, idZona);

        return rows.map((ocupacion) => ({
            intervaloInicio: ocupacion.intervaloInicio.toISOString(),
            idZona: ocupacion.idZona,
            dispositivosUnicos: ocupacion.dispositivosUnicos,
            dispositivosEstables: ocupacion.dispositivosEstables,
            nivelOcupacion: ocupacion.nivelOcupacion,
        }));
    }

    /**
     * Salud de la red de nodos de captura.
     */
    async sensorHealth(): Promise<SensorHealth[]> {
        const sensores = await this.sensores.findAll();
        const now = Date.now();

        return sensores.map((sensor) => {
            const minutos =
                sensor.ultimaConexion === null
                    ? null
                    : Math.floor((now - sensor.ultimaConexion.getTime()) / 60_000);

            return {
                idSensor: sensor.idSensor,
                nombre: sensor.nombre,
                zona: sensor.zona?.nombre ?? null,
                estado: sensor.estado,
                ultimaConexion: sensor.ultimaConexion?.toISOString() ?? null,
                minutosDesdeUltimaLectura: minutos,
                enLinea: minutos !== null && minutos < SENSOR_ONLINE_WINDOW_MINUTES,
            };
        });
    }

    /** Alertas de aglomeración abiertas. */
    alerts(): Promise<Alerta[]> {
        return this.alertas.findUnresolved();
    }

    /**
     * Marca una alerta como resuelta.
     *
     * @throws NotFoundError si no existe o ya estaba resuelta.
     */
    async resolveAlert(idAlerta: string, resueltaPor: string): Promise<void> {
        const ok = await this.alertas.resolve(idAlerta, resueltaPor);
        if (!ok) throw new NotFoundError('La alerta no existe o ya estaba resuelta');
    }

    /**
     * Parámetros de sensado en vigor. El dashboard los muestra junto a las
     * métricas porque los conteos no son interpretables sin saber con qué
     * ventana y con qué modelo de propagación se calcularon.
     */
    parameters(): {
        ventanaAgregacionMinutos: number;
        rssiReferencia: number;
        exponenteAtenuacion: number;
    } {
        return {
            ventanaAgregacionMinutos: this.cfg.aggregationIntervalMinutes,
            rssiReferencia: this.cfg.rssiReferenceDbm,
            exponenteAtenuacion: this.cfg.pathLossExponent,
        };
    }
}
