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

    /**
     * `POST /api/auth/login` — autentica al admin con username/email + password.
     * Devuelve `{ admin, token }` con 200.
     */
    login = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.login(req.body as LoginDto, req.ip ?? null);
        res.status(200).json(result);
    };

    /**
     * `POST /api/auth/register` — inicia el flujo de registro: crea un
     * pending y envía el código por correo. Devuelve 201 con
     * `{ message, verificationRequired: true }`.
     */
    register = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.register(req.body as RegisterDto);
        res.status(201).json(result);
    };

    /**
     * `POST /api/auth/verify-code` — valida el código y, si es correcto,
     * promueve el pending a admin definitivo. Devuelve `{ admin, token }`.
     */
    verifyCode = async (req: Request, res: Response): Promise<void> => {
        const result = await this.authService.verifyCode(req.body as VerifyCodeDto, req.ip ?? null);
        res.status(200).json(result);
    };

    /**
     * `POST /api/auth/cancel-verification` — cancela un pending de registro.
     * Idempotente: responde 200 incluso si no había pending.
     */
    cancelVerification = async (req: Request, res: Response): Promise<void> => {
        const { email } = req.body as CancelVerificationDto;
        await this.authService.cancelVerification(email);
        res.status(200).json({ message: 'Verificación cancelada' });
    };

    /**
     * `POST /api/auth/logout` — endpoint convencional sin estado server-side.
     * JWT es stateless: la sesión se "cierra" descartando el token en el cliente.
     * Si en el futuro se implementa blacklist de tokens, se invocaría dentro
     * de `authService.logout()`.
     */
    logout = async (req: Request, res: Response): Promise<void> => {
        if (!req.admin) throw new UnauthorizedError();
        res.status(200).json(await this.authService.logout(req.admin, req.token));
    };

    /**
     * `GET /api/auth/session` — devuelve el payload del admin autenticado
     * (poblado por `authMiddleware`). Sirve al frontend para revalidar
     * sesión al recargar la app.
     */
    session = (req: Request, res: Response): void => {
        if (!req.admin) throw new UnauthorizedError();
        res.status(200).json(this.authService.session(req.admin));
    };
}
