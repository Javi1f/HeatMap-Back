import { Request, Response, NextFunction } from 'express';
import authService from '../modules/auth/auth.service';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ message: 'Token no proporcionado', statusCode: 401 });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const payload = authService.verifyToken(token);
        (req as any).admin = payload;
        next();
    } catch {
        res.status(401).json({ message: 'Token inválido o expirado', statusCode: 401 });
    }
}