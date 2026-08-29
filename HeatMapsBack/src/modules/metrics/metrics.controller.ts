import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { MetricsService } from './metrics.service';
import { UnauthorizedError } from '../../common/errors';

/** Horas por defecto de la serie temporal si el cliente no las especifica. */
const DEFAULT_SERIES_HOURS = 6;

/**
 * Controlador HTTP del módulo de métricas.
 *
 * Igual que el resto: desempaqueta `req`, delega en el service y formatea.
 * Ninguna consulta se construye aquí.
 */
@injectable()
export class MetricsController {
    constructor(private readonly service: MetricsService) {}

    /** `GET /api/metrics/overview` — tarjetas de cabecera del dashboard. */
    overview = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.overview();
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/metrics/zones` — ocupación actual por zona. */
    zones = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.zones();
        res.status(200).json({ success: true, data });
    };

    /**
     * `GET /api/metrics/occupancy?hours=6&zoneId=<uuid>` — serie temporal.
     *
     * `hours` no válido cae al valor por defecto en lugar de dar 400: es un
     * parámetro de presentación, y un dashboard que se rompe por un query
     * string mal formado es peor que uno que muestra el rango habitual.
     */
    occupancy = async (req: Request, res: Response): Promise<void> => {
        const parsed = Number(req.query.hours);
        const hours = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SERIES_HOURS;
        const zoneId = typeof req.query.zoneId === 'string' ? req.query.zoneId : undefined;

        const data = await this.service.occupancySeries(hours, zoneId);
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/metrics/sensors` — salud de la red de nodos. */
    sensors = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.sensorHealth();
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/metrics/alerts` — alertas de aglomeración abiertas. */
    alerts = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.alerts();
        res.status(200).json({ success: true, data });
    };

    /** `POST /api/metrics/alerts/:id/resolve` — cierra una alerta. */
    resolveAlert = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as { id: string };
        await this.service.resolveAlert(id, req.admin.username);
        res.status(200).json({ success: true, message: 'Alerta resuelta' });
    };

    /** `GET /api/metrics/parameters` — parámetros de sensado en vigor. */
    parameters = (_req: Request, res: Response): void => {
        res.status(200).json({ success: true, data: this.service.parameters() });
    };
}
