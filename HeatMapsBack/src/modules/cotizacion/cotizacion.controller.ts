import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { CotizacionService } from './cotizacion.service';
import {
    ActualizarEstadoDto,
    CrearSolicitudDto,
    ListarSolicitudesConsulta,
    SolicitudIdParam,
} from './cotizacion.dto';

/**
 * Controlador de cotización.
 *
 * Dos caras que no se mezclan:
 *  - la pública (`/api/cotizacion`), donde cualquiera envía su solicitud;
 *  - la del panel (`/api/cotizaciones`), donde un administrador autenticado
 *    gestiona el ciclo comercial.
 */
@injectable()
export class CotizacionController {
    constructor(private readonly service: CotizacionService) {}

    /** `POST /api/cotizacion` — el visitante envía su solicitud. */
    crear = async (req: Request, res: Response): Promise<void> => {
        const dto = req.body as CrearSolicitudDto;
        const resultado = await this.service.crear(dto, req.ip ?? null);
        res.status(201).json({ success: true, data: resultado });
    };

    /** `GET /api/cotizaciones?estado=` — listado del panel. */
    listar = async (req: Request, res: Response): Promise<void> => {
        const { estado } = (req.query ?? {}) as ListarSolicitudesConsulta;
        const data = await this.service.listar(estado);
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/cotizaciones/:id` — detalle con el contacto descifrado. */
    obtener = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as SolicitudIdParam;
        const data = await this.service.obtener(id);
        res.status(200).json({ success: true, data });
    };

    /** `PATCH /api/cotizaciones/:id/estado` — mueve el ciclo comercial. */
    cambiarEstado = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as SolicitudIdParam;
        const dto = req.body as ActualizarEstadoDto;
        const data = await this.service.cambiarEstado(
            id,
            dto.estado,
            dto.notas,
            req.admin!.id,
            req.ip ?? null,
        );
        res.status(200).json({ success: true, data });
    };

    /** `DELETE /api/cotizaciones/:id` — elimina la solicitud. */
    eliminar = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as SolicitudIdParam;
        await this.service.eliminar(id, req.admin!.id, req.ip ?? null);
        res.status(200).json({ success: true, data: { message: 'Solicitud eliminada' } });
    };

    /** `GET /api/cotizaciones/:id/documento` — el .json de la solicitud. */
    documento = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as SolicitudIdParam;
        const data = await this.service.documento(id);
        res.status(200).json({ success: true, data });
    };
}
