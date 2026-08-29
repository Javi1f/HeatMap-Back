import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { UsersService } from './users.service';
import { UnauthorizedError } from '../../common/errors';

/**
 * Controlador HTTP de la sección de administración de usuarios.
 */
@injectable()
export class UsersController {
    constructor(private readonly service: UsersService) {}

    /** `GET /api/users/admins` — administradores registrados. */
    listAdmins = async (_req: Request, res: Response): Promise<void> => {
        const data = await this.service.listAdmins();
        res.status(200).json({ success: true, data });
    };

    /** `GET /api/users/sessions` — sesiones actualmente abiertas. */
    listSessions = async (req: Request, res: Response): Promise<void> => {
        const data = await this.service.listSessions(req.token);
        res.status(200).json({ success: true, data });
    };

    /**
     * `DELETE /api/users/sessions/:id` — cierra una sesión.
     *
     * Un administrador puede cerrar la suya propia (equivale a un logout) o la
     * de otro, que es el caso que justifica la pantalla: revocar el acceso de
     * una cuenta comprometida sin esperar a que caduque su token.
     */
    revokeSession = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as { id: string };
        await this.service.revokeSession(id);
        res.status(200).json({ success: true, message: 'Sesión cerrada' });
    };
}
