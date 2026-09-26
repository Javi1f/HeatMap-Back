import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { AllowedEmailsService } from './allowed-emails.service';
import { AddAllowedEmailDto, AllowedEmailIdParam } from './dto/add-email.dto';
import { UnauthorizedError } from '../../../common/errors';

/**
 * Controlador HTTP del módulo de correos permitidos.
 *
 * Sigue las mismas reglas que `AuthController`: solo desempaqueta `req`,
 * delega al service y formatea la respuesta.
 */
@injectable()
export class AllowedEmailsController {
    constructor(private readonly service: AllowedEmailsService) {}

    /**
     * `GET /api/allowed-emails` — lista todos los correos permitidos
     * (descifrados) en orden descendente por fecha de creación.
     */
    getAll = async (_req: Request, res: Response): Promise<void> => {
        const emails = await this.service.getAll();
        res.status(200).json({ success: true, data: emails });
    };

    /**
     * `POST /api/allowed-emails` — añade un correo a la lista blanca.
     * Registra al admin autenticado como quien lo autorizó (`anadido_por`).
     */
    add = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { email } = req.body as AddAllowedEmailDto;
        const result = await this.service.add(email, req.admin);
        res.status(201).json({ success: true, data: result });
    };

    /**
     * `DELETE /api/allowed-emails/:id` — elimina un correo de la lista por id.
     * El servicio rechaza el correo fundador y el del propio solicitante.
     */
    remove = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as unknown as AllowedEmailIdParam;
        await this.service.remove(id, req.admin);
        res.status(200).json({ success: true, message: 'Correo eliminado de la lista' });
    };
}
