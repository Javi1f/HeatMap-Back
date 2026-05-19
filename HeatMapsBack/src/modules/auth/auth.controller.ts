import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { CancelVerificationDto } from './dto/cancel-verification.dto';
import { UnauthorizedError } from '../../common/errors';

/**
 * Controlador HTTP del módulo de autenticación.
 *
 * Reglas que respeta:
 *  - NO contiene lógica de negocio: solo desempaqueta `req`, llama al
 *    `AuthService` y envía la respuesta.
 *  - NO captura errores: los deja propagar al `errorHandler` central
 *    (los handlers se montan con `asyncHandler` en las rutas).
 *  - NO conoce nada de cifrado, ORM, JWT, etc.
 *
 * El body de las peticiones ya está validado y tipado por el middleware
 * `validate(...)` antes de llegar aquí — por eso podemos hacer cast a DTO
 * con seguridad.
 */
@injectable()
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    login = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.login(req.body as LoginDto);
        res.status(200).json(result);
    };

    register = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.register(req.body as RegisterDto);
        res.status(201).json(result);
    };

    verifyCode = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.verifyCode(req.body as VerifyCodeDto);
        res.status(200).json(result);
    };

    cancelVerification = async (req: Request, res: Response): Promise<void> => {
        const { email } = req.body as CancelVerificationDto;
        await this.authService.cancelVerification(email);
        res.status(200).json({ message: 'Verificación cancelada' });
    };

    logout = (_req: Request, res: Response): void => {
        // JWT stateless: la sesión se "cierra" descartando el token en el cliente.
        // Si se implementa blacklist de tokens, llamar aquí al servicio.
        res.status(200).json({ message: 'Sesión cerrada exitosamente' });
    };

    session = (req: Request, res: Response): void => {
        if (!req.admin) throw new UnauthorizedError();
        res.status(200).json({ admin: req.admin, isValid: true });
    };
}
