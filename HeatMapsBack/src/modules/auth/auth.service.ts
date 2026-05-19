import { injectable } from 'tsyringe';
import { Admin } from '../../models/Admin.entity';
import { PendingRegistration } from '../../models/PendingRegistration.entity';
import { JwtPayload } from '../../types/auth.types';
import { AdminRepository } from './repositories/admin.repository';
import { PendingRegistrationRepository } from './repositories/pending-registration.repository';
import { JwtService } from './services/jwt.service';
import { PasswordService } from './services/password.service';
import { VerificationCodeService } from './services/verification-code.service';
import { AllowedEmailsService } from '../allowed-emails/allowed-emails.service';
import { MailerService } from '../mailer/mailer.service';
import { DbFieldCipher } from '../../crypto/db-field.crypto';
import { LoggerService } from '../../common/logger/logger.service';
import {
    ConflictError,
    EmailNotAllowedError,
    InvalidCredentialsError,
    InvalidVerificationCodeError,
    NotFoundError,
    TooManyAttemptsError,
    VerificationCodeExpiredError,
} from '../../common/errors';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

/**
 * Vista pública (descifrada) de un administrador. Solo expone los campos
 * que el frontend necesita; nunca devuelvas la entidad completa.
 */
export interface AdminView {
    id: number;
    username: string;
    email: string;
}

/** Resultado de un login o verificación exitosa. */
export interface AuthResult {
    admin: AdminView;
    token: string;
}

/** Resultado de iniciar el flujo de registro. */
export interface RegisterResult {
    message: string;
    verificationRequired: true;
}

/**
 * Servicio de autenticación y gestión del ciclo de registro.
 *
 * Orquesta:
 *  - Login (verifica credenciales y emite JWT).
 *  - Registro en dos pasos (lista blanca → pending + correo → verify-code → admin).
 *  - Cancelación de registro pendiente.
 *
 * NO conoce nada de Express: solo recibe DTOs y devuelve datos o lanza
 * errores de la jerarquía {@link AppError}. El mapeo a HTTP lo hacen el
 * controlador y el `errorHandler` central.
 */
@injectable()
export class AuthService {
    constructor(
        private readonly adminRepo: AdminRepository,
        private readonly pendingRepo: PendingRegistrationRepository,
        private readonly jwt: JwtService,
        private readonly password: PasswordService,
        private readonly verification: VerificationCodeService,
        private readonly allowed: AllowedEmailsService,
        private readonly mailer: MailerService,
        private readonly cipher: DbFieldCipher,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Autentica un administrador por username o email + password.
     *
     * @throws {@link InvalidCredentialsError} si no existe o el password no coincide.
     */
    async login(dto: LoginDto): Promise<AuthResult> {
        const inputHash = this.cipher.hash(dto.username);
        const admin = await this.adminRepo.findByUsernameOrEmailHash(inputHash);
        if (!admin) throw new InvalidCredentialsError();

        const ok = await this.password.verify(dto.password, admin.password);
        if (!ok) throw new InvalidCredentialsError();

        const view = this.toView(admin);
        const token = this.jwt.sign(view);
        return { admin: view, token };
    }

    /**
     * Inicia el flujo de registro.
     *
     * 1. Valida que el email esté en la lista blanca.
     * 2. Valida que no exista ya un admin con ese email/username.
     * 3. Limpia cualquier pending previo para ese email.
     * 4. Crea un PendingRegistration con código y expiración.
     * 5. Envía el código por correo.
     *
     * @throws {@link EmailNotAllowedError} si el correo no está autorizado.
     * @throws {@link ConflictError} si ya existe un admin con ese email/username.
     */
    async register(dto: RegisterDto): Promise<RegisterResult> {
        if (!(await this.allowed.isAllowed(dto.email))) {
            throw new EmailNotAllowedError();
        }

        const emailHash = this.cipher.hash(dto.email);
        const usernameHash = this.cipher.hash(dto.username);

        if (await this.adminRepo.findByEmailHash(emailHash)) {
            throw new ConflictError('El email ya está registrado');
        }
        if (await this.adminRepo.findByUsernameHash(usernameHash)) {
            throw new ConflictError('El username ya está en uso');
        }

        await this.pendingRepo.deleteByEmailHash(emailHash);

        const hashedPassword = await this.password.hash(dto.password);
        const code = this.verification.generate();
        const expiresAt = this.verification.expiryDate();

        await this.pendingRepo.create({
            username: this.cipher.encrypt(dto.username),
            usernameHash,
            email: this.cipher.encrypt(dto.email),
            emailHash,
            password: hashedPassword,
            code: this.cipher.encrypt(code),
            expiresAt,
            attempts: 0,
        });

        await this.mailer.sendVerificationCode(dto.email, code);
        this.logger.info(`Registro pendiente creado para ${emailHash}`);

        return { message: 'Código de verificación enviado al correo', verificationRequired: true };
    }

    /**
     * Verifica el código asociado a un registro pendiente y promueve el
     * pending a un admin definitivo si es correcto.
     *
     * Manejo de intentos:
     *  - Si el código expiró → elimina el pending y lanza {@link VerificationCodeExpiredError}.
     *  - Si ya hay `maxAttempts` intentos → elimina el pending y lanza {@link TooManyAttemptsError}.
     *  - Si el código no coincide → incrementa intentos y lanza {@link InvalidVerificationCodeError}
     *    con `attemptsLeft` en `details`.
     *
     * @throws {@link NotFoundError} si no hay pending para ese email.
     */
    async verifyCode(dto: VerifyCodeDto): Promise<AuthResult> {
        const emailHash = this.cipher.hash(dto.email);
        const pending = await this.pendingRepo.findByEmailHash(emailHash);
        if (!pending) {
            throw new NotFoundError('No hay un registro pendiente para este correo');
        }

        if (new Date() > pending.expiresAt) {
            await this.pendingRepo.deleteById(pending.id);
            throw new VerificationCodeExpiredError();
        }

        if (pending.attempts >= this.verification.maxAttempts) {
            await this.pendingRepo.deleteById(pending.id);
            throw new TooManyAttemptsError();
        }

        const decryptedCode = this.cipher.decrypt(pending.code);
        if (decryptedCode !== dto.code) {
            await this.pendingRepo.incrementAttempts(pending.id, pending.attempts);
            const attemptsLeft = this.verification.maxAttempts - (pending.attempts + 1);
            throw new InvalidVerificationCodeError(attemptsLeft);
        }

        const admin = await this.promoteToAdmin(pending, emailHash);
        await this.pendingRepo.deleteById(pending.id);

        const view = this.toView(admin);
        const token = this.jwt.sign(view);
        return { admin: view, token };
    }

    /**
     * Cancela un registro pendiente (por petición del usuario).
     * Idempotente: si no existe no falla.
     */
    async cancelVerification(email: string): Promise<void> {
        const emailHash = this.cipher.hash(email);
        await this.pendingRepo.deleteByEmailHash(emailHash);
    }

    /**
     * Crea el Admin definitivo a partir del PendingRegistration verificado.
     */
    private promoteToAdmin(pending: PendingRegistration, emailHash: string): Promise<Admin> {
        const username = this.cipher.decrypt(pending.username);
        const email = this.cipher.decrypt(pending.email);
        const usernameHash = this.cipher.hash(username);

        return this.adminRepo.create({
            username: this.cipher.encrypt(username),
            usernameHash,
            email: this.cipher.encrypt(email),
            emailHash,
            password: pending.password,
        });
    }

    /**
     * Convierte la entidad cifrada en su vista pública descifrada.
     */
    private toView(admin: Admin): AdminView {
        return {
            id: admin.id,
            username: this.cipher.decrypt(admin.username),
            email: this.cipher.decrypt(admin.email),
        };
    }

    /**
     * Extrae y verifica el payload de un token. Reexpuesto aquí por
     * conveniencia para el middleware, que prefiere depender de un único
     * servicio del módulo en lugar de conocer `JwtService`.
     */
    verifyToken(token: string): JwtPayload {
        return this.jwt.verify(token);
    }
}
