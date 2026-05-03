import { Request, Response } from 'express';
import allowedEmailsService from './allowed-emails.service';

class AllowedEmailsController {

    async getAll(req: Request, res: Response): Promise<void> {
        try {
            const emails = await allowedEmailsService.getAll();
            res.status(200).json({ success: true, data: emails });
        } catch (err: any) {
            res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode || 500 });
        }
    }

    async add(req: Request, res: Response): Promise<void> {
        try {
            const admin = (req as any).admin;
            const { email } = req.body;

            if (!email) {
                res.status(400).json({ message: 'El email es requerido', statusCode: 400 });
                return;
            }

            const result = await allowedEmailsService.add(email, admin.username);
            res.status(201).json({ success: true, data: result });
        } catch (err: any) {
            res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode || 500 });
        }
    }

    async remove(req: Request, res: Response): Promise<void> {
        try {
            await allowedEmailsService.remove(parseInt(req.params['id'] as string, 10));
            res.status(200).json({ success: true, message: 'Correo eliminado de la lista' });
        } catch (err: any) {
            res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode || 500 });
        }
    }
}

export default new AllowedEmailsController();