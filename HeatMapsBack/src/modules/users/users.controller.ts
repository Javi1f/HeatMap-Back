import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { UsersService } from './users.service';
import { AuditoriaService } from './auditoria.service';
import { UnauthorizedError } from '../../common/errors';
import type { AdminIdParam, AuditoriaQuery, CambiarActivoDto, CambiarRolDto } from './dto/usuarios.dto';

/**
 * Controlador HTTP de la sección de administración de usuarios.
 *
 * Todas sus rutas exigen el rol `root`.
 */
@injectable()
export class UsersController {
    constructor(
        private readonly service: UsersService,
        private readonly auditoria: AuditoriaService,
    ) {}

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
     * Permite revocar el acceso de una cuenta comprometida sin esperar a que
     * caduque su token.
     */
    revokeSession = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as { id: string };
        await this.service.revokeSession(id);
        await this.auditoria.registrar({ tipo: 'sesion_revocada', idAdmin: req.admin.id, detalle: `sesion=${id}`, ip: req.ip });
        res.status(200).json({ success: true, message: 'Sesión cerrada' });
    };

    /** `PATCH /api/users/admins/:id/rol` — cambia el rol de una cuenta. */
    cambiarRol = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as unknown as AdminIdParam;
        const { rol } = req.body as CambiarRolDto;
        await this.service.cambiarRol(id, rol);
        await this.auditoria.registrar({ tipo: 'rol_cambiado', idAdmin: req.admin.id, detalle: `admin=${id} rol=${rol}`, ip: req.ip });
        res.status(200).json({ success: true, message: 'Rol actualizado' });
    };

    /** `PATCH /api/users/admins/:id/activo` — activa o desactiva una cuenta. */
    cambiarActivo = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        const { id } = req.params as unknown as AdminIdParam;
        const { activo } = req.body as CambiarActivoDto;
        await this.service.cambiarActivo(req.admin.id, id, activo);
        await this.auditoria.registrar({
            tipo: activo ? 'admin_activado' : 'admin_desactivado',
            idAdmin: req.admin.id,
            detalle: `admin=${id}`,
            ip: req.ip,
        });
        res.status(200).json({ success: true, message: activo ? 'Cuenta activada' : 'Cuenta desactivada' });
    };

    /** `GET /api/users/auditoria` — últimos eventos de auditoría. */
    listarAuditoria = async (req: Request, res: Response): Promise<void> => {
        const { limite } = req.query as unknown as AuditoriaQuery;
        const data = await this.auditoria.listar(limite);
        res.status(200).json({ success: true, data });
    };
}
