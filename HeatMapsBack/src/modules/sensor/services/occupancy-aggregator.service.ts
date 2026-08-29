import { singleton } from 'tsyringe';
import { LoggerService } from '../../../common/logger/logger.service';
import { SensingConfig } from '../../../config/sensing.config';
import { NivelOcupacion } from '../../../models/OcupacionAgregada.entity';
import { Zona } from '../../../models/Zona.entity';
import { AlertaRepository } from '../repositories/alerta.repository';
import {
    ConteoZona,
    OcupacionInsert,
    OcupacionRepository,
} from '../repositories/ocupacion.repository';
import { ZonaRepository } from '../repositories/zona.repository';

/**
 * Umbrales absolutos para zonas sin aforo declarado.
 *
 * Cuando `capacidadMax` es null no hay porcentaje que calcular, así que se cae
 * a estos números. Son deliberadamente conservadores: sirven para que la zona
 * «Sin asignar» no dispare alertas constantes, no como criterio de aforo real.
 */
const UMBRAL_ABSOLUTO_MEDIA = 30;
const UMBRAL_ABSOLUTO_ALTA = 60;

/**
 * Consolida periódicamente las detecciones crudas en ocupación por zona y
 * levanta alertas cuando una zona entra en nivel alto.
 *
 * **Por qué en ventanas cerradas y no en cada mensaje**: el conteo de una zona
 * es un `COUNT(DISTINCT macHash)` sobre todas las detecciones del intervalo.
 * Recalcularlo con cada lectura entrante sería cuadrático en el número de
 * mensajes; hacerlo una vez por ventana lo deja en una consulta por intervalo.
 *
 * **Ventanas alineadas al reloj**: el intervalo se alinea a múltiplos exactos
 * de su duración (12:00, 12:05, 12:10…), no al momento de arranque del
 * proceso. Así un reinicio no desplaza la rejilla temporal y las series de
 * distintos días son comparables entre sí.
 *
 * Alcance único: el temporizador de consolidación pertenece al proceso. Con
 * alcance transitorio, detenerlo actuaría sobre una instancia que nunca lo
 * arrancó y el intervalo real seguiría vivo.
 */
@singleton()
export class OccupancyAggregatorService {
    /** Temporizador de la consolidacion, o `null` si esta detenida. */
    private timer: NodeJS.Timeout | null = null;

    constructor(
        private readonly ocupacion: OcupacionRepository,
        private readonly alertas: AlertaRepository,
        private readonly zonas: ZonaRepository,
        private readonly cfg: SensingConfig,
        private readonly logger: LoggerService,
    ) {}

    /** @returns true si el agregador está corriendo. */
    get running(): boolean {
        return this.timer !== null;
    }

    /**
     * Arranca la consolidación periódica. Idempotente.
     *
     * El temporizador se marca con `unref` para que no mantenga vivo el
     * proceso por sí solo: durante el apagado, un intervalo activo impediría
     * que el bucle de eventos drenara.
     */
    start(): void {
        if (this.timer) return;

        const periodMs = this.cfg.aggregationIntervalMinutes * 60_000;
        this.timer = setInterval(() => {
            this.runOnce().catch((err) =>
                this.logger.error('Fallo consolidando ocupación', err),
            );
        }, periodMs);
        this.timer.unref();

        this.logger.info(
            `Agregador de ocupación iniciado (ventana de ${this.cfg.aggregationIntervalMinutes} min)`,
        );
    }

    /** Detiene la consolidación periódica. Idempotente. */
    stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        this.logger.info('Agregador de ocupación detenido');
    }

    /**
     * Consolida la última ventana ya cerrada.
     *
     * Es público para poder invocarlo desde un endpoint administrativo o desde
     * un test sin esperar al temporizador.
     */
    async runOnce(): Promise<void> {
        const { start, end } = this.lastClosedWindow();

        if (await this.ocupacion.windowExists(start)) {
            this.logger.debug(`Ventana ${start.toISOString()} ya consolidada, se omite`);
            return;
        }

        const conteos = await this.ocupacion.aggregateWindow(start, end);
        if (conteos.length === 0) {
            this.logger.debug(`Sin detecciones en la ventana ${start.toISOString()}`);
            return;
        }

        const zonas = new Map((await this.zonas.findAll()).map((z) => [z.idZona, z]));

        const filas: OcupacionInsert[] = conteos.map((conteo) => ({
            idZona: conteo.idZona,
            intervaloInicio: start,
            intervaloFin: end,
            dispositivosUnicos: conteo.dispositivosUnicos,
            dispositivosEstables: conteo.dispositivosEstables,
            rssiPromedio:
                conteo.rssiPromedio === null
                    ? null
                    : Math.round(conteo.rssiPromedio * 100) / 100,
            nivelOcupacion: this.classify(conteo, zonas.get(conteo.idZona)),
        }));

        await this.ocupacion.insertMany(filas);
        this.logger.info(
            `Ocupación consolidada: ${filas.length} zona(s) en la ventana ${start.toISOString()}`,
        );

        await this.raiseAlerts(filas, zonas, conteos);
    }

    /**
     * Clasifica el nivel de ocupación de una zona.
     *
     * Usa `dispositivosUnicos` porque es el techo del conteo: para una alerta
     * de aglomeración es preferible avisar de más que de menos.
     */
    private classify(conteo: ConteoZona, zona?: Zona): NivelOcupacion {
        const n = conteo.dispositivosUnicos;

        if (!zona?.capacidadMax) {
            if (n >= UMBRAL_ABSOLUTO_ALTA) return 'alta';
            if (n >= UMBRAL_ABSOLUTO_MEDIA) return 'media';
            return 'baja';
        }

        const ratio = n / zona.capacidadMax;
        if (ratio >= this.cfg.occupancyHighRatio) return 'alta';
        if (ratio >= this.cfg.occupancyMediumRatio) return 'media';
        return 'baja';
    }

    /**
     * Crea una alerta por cada zona en nivel alto que no tenga ya una abierta.
     *
     * La comprobación previa evita inundar la tabla: una plazoleta llena
     * durante una hora generaría doce alertas idénticas con una ventana de
     * cinco minutos.
     */
    private async raiseAlerts(
        filas: { idZona: string; nivelOcupacion: NivelOcupacion }[],
        zonas: Map<string, Zona>,
        conteos: ConteoZona[],
    ): Promise<void> {
        const porZona = new Map(conteos.map((c) => [c.idZona, c]));

        for (const fila of filas) {
            if (fila.nivelOcupacion !== 'alta') continue;
            if (await this.alertas.hasOpenForZone(fila.idZona)) continue;

            const zona = zonas.get(fila.idZona);
            const detectados = porZona.get(fila.idZona)?.dispositivosUnicos ?? 0;
            const aforo = zona?.capacidadMax ? ` sobre un aforo de ${zona.capacidadMax}` : '';

            await this.alertas.create(
                fila.idZona,
                'advertencia',
                `Ocupación alta en ${zona?.nombre ?? 'zona desconocida'}: ${detectados} dispositivos detectados${aforo}.`,
            );
            this.logger.warn(`Alerta de aglomeración levantada en zona ${fila.idZona}`);
        }
    }

    /**
     * Calcula la última ventana completa, alineada al reloj.
     *
     * Con ventana de 5 minutos y hora actual 12:07, devuelve [12:00, 12:05):
     * la ventana en curso (12:05–12:10) aún puede recibir detecciones y
     * consolidarla ahora daría un conteo incompleto.
     */
    private lastClosedWindow(): { start: Date; end: Date } {
        const periodMs = this.cfg.aggregationIntervalMinutes * 60_000;
        const alignedNow = Math.floor(Date.now() / periodMs) * periodMs;
        return {
            start: new Date(alignedNow - periodMs),
            end: new Date(alignedNow),
        };
    }
}
