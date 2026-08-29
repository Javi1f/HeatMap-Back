import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { ValidationError } from '../../common/errors';
import { PublicoService } from './publico.service';

/** Horas por defecto de la ventana si el visitante no la especifica. */
const VENTANA_POR_DEFECTO_MIN = 5;

/**
 * Controlador de la vista pública.
 *
 * Sus respuestas las puede leer cualquiera, así que no acepta ningún parámetro
 * que altere el estado ni expone mensajes de error que revelen la estructura
 * interna: un identificador inexistente responde 404 a secas.
 */
@injectable()
export class PublicoController {
    constructor(private readonly service: PublicoService) {}

    /** `GET /api/publico/zonas` — espacios consultables. */
    zonas = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.listarZonas();
        res.status(200).json({ success: true, data });
    };

    /**
     * `GET /api/publico/mapa?zonaId=<uuid>&minutos=5` — mapa de ocupación.
     */
    mapa = async (req: Request, res: Response): Promise<void> => {
        const zonaId = typeof req.query.zonaId === 'string' ? req.query.zonaId : '';
        if (!zonaId) throw new ValidationError('Falta el parámetro zonaId');

        const parsed = Number(req.query.minutos);
        const minutos = Number.isFinite(parsed) && parsed > 0 ? parsed : VENTANA_POR_DEFECTO_MIN;

        const data = await this.service.mapa(zonaId, minutos);
        res.status(200).json({ success: true, data });
    };
}
