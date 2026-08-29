import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { UnauthorizedError } from '../../common/errors';
import { CrearReporteDto, ReporteIdParam } from './dto/reporte.dto';
import { ReportesService } from './reportes.service';

/**
 * Controlador HTTP del módulo de reportes.
 *
 * Como el resto: desempaqueta `req`, delega en el service y formatea. Ninguna
 * consulta ni regla de negocio vive aquí.
 */
@injectable()
export class ReportesController {
    constructor(private readonly service: ReportesService) {}

    /**
     * `POST /api/reportes` — guarda una definición y devuelve su primer cálculo.
     */
    crear = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const dto = req.body as CrearReporteDto;
        const data = await this.service.crear(dto, req.admin.id);
        res.status(201).json({ success: true, data });
    };

    /** `GET /api/reportes` — definiciones guardadas, sin calcular. */
    listar = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.listar();
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/reportes/:id` — definición con sus datos recalculados. */
    obtener = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as unknown as ReporteIdParam;
        const data = await this.service.obtener(id);
        res.status(200).json({ success: true, data });
    };

    /**
     * `GET /api/reportes/:id/csv` — contenido del CSV y nombre sugerido.
     *
     * No devuelve el archivo como descarga directa: viaja como texto dentro de
     * la respuesta cifrada y es el cliente quien construye la descarga. Así
     * esta ruta no necesita saltarse el middleware de cifrado.
     */
    exportarCsv = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as unknown as ReporteIdParam;
        const data = await this.service.exportarCsv(id);
        res.status(200).json({ success: true, data });
    };

    /** `DELETE /api/reportes/:id` — elimina la definición. */
    eliminar = async (req: Request, res: Response): Promise<void> => {
        const { id } = req.params as unknown as ReporteIdParam;
        await this.service.eliminar(id);
        res.status(200).json({ success: true, message: 'Reporte eliminado' });
    };
}
