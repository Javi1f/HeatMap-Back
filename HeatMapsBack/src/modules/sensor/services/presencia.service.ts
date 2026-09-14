import { singleton } from 'tsyringe';
import { SensingConfig } from '../../../config/sensing.config';
import { LoggerService } from '../../../common/logger/logger.service';
import { CapturaRepository, SenalEnZona } from '../repositories/captura.repository';
import { InfraestructuraInsert, InfraestructuraRepository } from '../repositories/infraestructura.repository';
import { EvaluacionPresencia, evaluarPresencia } from './presencia';

/**
 * Cada cuánto se renueva en base de datos la marca de un mismo dispositivo.
 *
 * Los nodos emiten cada pocos segundos y un punto de acceso aparece en todas
 * las lecturas: escribirlo cada vez serían cientos de escrituras por minuto
 * para mover una fecha que caduca en horas.
 */
const RENOVACION_MS = 10 * 60_000;

/** Entradas a partir de las cuales se vacía la memoria de renovaciones. */
const TOPE_RENOVACIONES = 5_000;

/**
 * Aplica el criterio de presencia sobre los datos guardados y mantiene el
 * registro de infraestructura.
 *
 * Es el único punto por el que el sistema decide quién está en una zona: el
 * mapa de calor, la ocupación consolidada y el panel pasan por aquí, así que
 * las tres cifras cuentan lo mismo.
 *
 * Alcance único para que la memoria de renovaciones sea del proceso y no de
 * cada resolución.
 */
@singleton()
export class PresenciaService {
    /** Última renovación de cada hash, en milisegundos. */
    private readonly renovados = new Map<string, number>();

    constructor(
        private readonly capturas: CapturaRepository,
        private readonly infraestructura: InfraestructuraRepository,
        private readonly cfg: SensingConfig,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Registra la infraestructura detectada en una lectura.
     *
     * Un fallo aquí se registra y no se propaga: perder una renovación sólo
     * retrasa la marca, y no debe impedir que la lectura se guarde y se emita.
     *
     * @param detectados - Dispositivos clasificados, ya anonimizados.
     * @param momento    - Momento de la lectura.
     */
    async anotarInfraestructura(detectados: readonly InfraestructuraInsert[], momento: Date): Promise<void> {
        const ahora = Date.now();
        const pendientes = detectados.filter(
            (fila) => ahora - (this.renovados.get(fila.macHash) ?? 0) >= RENOVACION_MS,
        );
        if (pendientes.length === 0) return;

        try {
            await this.infraestructura.registrar(pendientes, momento);
            if (this.renovados.size > TOPE_RENOVACIONES) this.renovados.clear();
            for (const fila of pendientes) this.renovados.set(fila.macHash, ahora);
        } catch (err) {
            this.logger.error('No se pudo registrar la infraestructura detectada', err);
        }
    }

    /**
     * Evalúa la presencia en cada zona durante una ventana.
     *
     * @param desde  - Inicio de la ventana, inclusivo.
     * @param hasta  - Fin de la ventana, exclusivo.
     * @param idZona - Limita la evaluación a una zona.
     * @returns Evaluación por zona; las zonas sin detecciones no aparecen.
     */
    async evaluar(desde: Date, hasta: Date, idZona?: string): Promise<Map<string, EvaluacionPresencia>> {
        const confirmadosDesde = new Date(hasta.getTime() - this.cfg.infraestructuraVigenciaHoras * 3_600_000);

        const [senales, excluidos] = await Promise.all([
            this.capturas.senalesPorNodo(desde, hasta, idZona),
            this.infraestructura.vigentes(confirmadosDesde),
        ]);

        const porZona = new Map<string, SenalEnZona[]>();
        for (const senal of senales) {
            const deLaZona = porZona.get(senal.idZona) ?? [];
            deLaZona.push(senal);
            porZona.set(senal.idZona, deLaZona);
        }

        const criterios = { rssiMinimoDbm: this.cfg.presenciaRssiMinimoDbm, excluidos };
        return new Map([...porZona].map(([zona, deLaZona]) => [zona, evaluarPresencia(deLaZona, criterios)]));
    }
}
