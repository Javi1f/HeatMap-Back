import { AppDataSource } from '../../config/database.config';
import { Admin } from '../../models/Admin.entity';
import { PendingRegistration } from '../../models/PendingRegistration.entity';
import { JwtPayload, LoginRequest, RegisterRequest, VerifyCodeRequest } from '../../types/auth.types';
import { sendVerificationEmail } from '../../utils/mailer';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import logger from '../../utils/logger';
import allowedEmailsService from "../allowed-emails/allowed-emails.service";

const adminRepo = () => AppDataSource.getRepository(Admin);
const pendingRepo = () => AppDataSource.getRepository(PendingRegistration);

const MAX_ATTEMPTS = parseInt(process.env.MAX_VERIFICATION_ATTEMPTS || '3', 10);
const CODE_EXPIRES_MIN = parseInt(process.env.VERIFICATION_CODE_EXPIRES_MINUTES || '15', 10);

class AuthService {

    generateToken(admin: Admin): string {
        const payload: JwtPayload = {
            id: admin.id,
            username: admin.username,
            email: admin.email
        };
        const options: SignOptions = {
            expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as SignOptions['expiresIn']
        };
        return jwt.sign(payload, process.env.JWT_SECRET as string, options);
    }

    async login(body: LoginRequest): Promise<{ admin: Partial<Admin>; token: string }> {
        const admin = await adminRepo().findOne({
            where: [{ username: body.username }, { email: body.username }]
        });

        if (!admin) throw { statusCode: 401, message: 'Credenciales incorrectas' };

        const valid = await bcrypt.compare(body.password, admin.password);
        if (!valid) throw { statusCode: 401, message: 'Credenciales incorrectas' };

        const token = this.generateToken(admin);
        return {
            admin: { id: admin.id, username: admin.username, email: admin.email },
            token
        };
    }

    async register(body: RegisterRequest): Promise<{ message: string; verificationRequired: boolean }> {

        const allowed = await allowedEmailsService.isAllowed(body.email);
        if (!allowed) throw { statusCode: 403, message: 'Este correo no está autorizado para registrarse' };

        const existingAdmin = await adminRepo().findOne({
            where: [{ email: body.email }, { username: body.username }]
        });
        if (existingAdmin?.email === body.email) throw { statusCode: 400, message: 'El email ya está registrado' };
        if (existingAdmin?.username === body.username) throw { statusCode: 400, message: 'El username ya está en uso' };

        // Eliminar cualquier registro pendiente anterior con ese email
        await pendingRepo().delete({ email: body.email });

        const hashedPassword = await bcrypt.hash(body.password, 12);
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        const expiresAt = new Date(Date.now() + CODE_EXPIRES_MIN * 60 * 1000);

        await pendingRepo().save(pendingRepo().create({
            username: body.username,
            email: body.email,
            password: hashedPassword,
            code,
            expiresAt,
            attempts: 0
        }));

        await sendVerificationEmail(body.email, code);
        logger.info(`Código de verificación enviado a ${body.email}`);

        return { message: 'Código de verificación enviado al correo', verificationRequired: true };
    }

    async verifyCode(body: VerifyCodeRequest): Promise<{ admin: Partial<Admin>; token: string }> {
        const pending = await pendingRepo().findOne({ where: { email: body.email } });

        if (!pending) throw { statusCode: 400, message: 'No hay un registro pendiente para este correo' };

        if (new Date() > pending.expiresAt) {
            await pendingRepo().delete({ id: pending.id });
            throw { statusCode: 400, message: 'El código ha expirado, vuelve a registrarte' };
        }

        if (pending.attempts >= MAX_ATTEMPTS) {
            await pendingRepo().delete({ id: pending.id });
            throw { statusCode: 400, message: 'Demasiados intentos fallidos, vuelve a registrarte', attemptsLeft: 0 };
        }

        if (pending.code !== body.code) {
            await pendingRepo().update(pending.id, { attempts: pending.attempts + 1 });
            const attemptsLeft = MAX_ATTEMPTS - (pending.attempts + 1);
            throw { statusCode: 400, message: 'Código incorrecto', attemptsLeft };
        }

        const admin = adminRepo().create({
            username: pending.username,
            email: pending.email,
            password: pending.password,
        });

        const saved = await adminRepo().save(admin);
        await pendingRepo().delete({ id: pending.id });

        const token = this.generateToken(saved);
        return {
            admin: { id: saved.id, username: saved.username, email: saved.email },
            token
        };
    }

    async cancelVerification(email: string): Promise<void> {
        await pendingRepo().delete({ email });
    }

    verifyToken(token: string): JwtPayload {
        return jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    }
}

export default new AuthService();