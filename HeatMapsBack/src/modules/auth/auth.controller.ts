import { Request, Response } from 'express';
import authService from './auth.service';

class AuthController {

    async login(req: Request, res: Response): Promise<void> {
        try {
            const result = await authService.login(req.body);
            res.status(200).json(result);
        } catch (err: any) {
            res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode || 500 });
        }
    }

    async register(req: Request, res: Response): Promise<void> {
        try {
            const result = await authService.register(req.body);
            res.status(201).json(result);
        } catch (err: any) {
            res.status(err.statusCode || 500).json({ message: err.message, statusCode: err.statusCode || 500 });
        }
    }

    async verifyCode(req: Request, res: Response): Promise<void> {
        try {
            const result = await authService.verifyCode(req.body);
            res.status(200).json(result);
        } catch (err: any) {
            res.status(err.statusCode || 500).json({
                message: err.message,
                attemptsLeft: err.attemptsLeft,
                statusCode: err.statusCode || 500
            });
        }
    }

    async cancelVerification(req: Request, res: Response): Promise<void> {
        try {
            await authService.cancelVerification(req.body.email);
            res.status(200).json({ message: 'Verificación cancelada' });
        } catch (err: any) {
            res.status(500).json({ message: err.message, statusCode: 500 });
        }
    }

    logout(req: Request, res: Response): void {
        res.status(200).json({ message: 'Sesión cerrada exitosamente' });
    }

    session(req: Request, res: Response): void {
        const admin = (req as any).admin;
        res.status(200).json({ admin, isValid: true });
    }
}

export default new AuthController();