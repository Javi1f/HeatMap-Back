import { AppDataSource } from '../../config/database.config';
import { Admin } from '../../models/Admin.entity';
import { PendingRegistration } from '../../models/PendingRegistration.entity';
import { JwtPayload, LoginRequest, RegisterRequest, VerifyCodeRequest } from '../../types/auth.types';
import { sendVerificationEmail } from '../../utils/mailer';
import { encryptField, decryptField, hashField } from '../../utils/db-crypto.util';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import logger from '../../utils/logger';
import allowedEmailsService from "../allowed-emails/allowed-emails.service";

const adminRepo = () => AppDataSource.getRepository(Admin);
const pendingRepo = () => AppDataSource.getRepository(PendingRegistration);

const MAX_ATTEMPTS = parseInt(process.env.MAX_VERIFICATION_ATTEMPTS || '3', 10);
const CODE_EXPIRES_MIN = parseInt(process.env.VERIFICATION_CODE_EXPIRES_MINUTES || '15', 10);

function decryptAdmin(admin: Admin): Admin {
    admin.username = decryptField(admin.username);
    admin.email = decryptField(admin.email);
    return admin;
}

function decryptPending(pending: PendingRegistration): PendingRegistration {
    pending.username = decryptField(pending.username);
    pending.email = decryptField(pending.email);
    pending.code = decryptField(pending.code);
    return pending;
}

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
        const inputHash = hashField(body.username);

        const admin = await adminRepo().findOne({
            where: [{ emailHash: inputHash }, { usernameHash: inputHash }]
        });

        if (!admin) throw { statusCode: 401, message: 'Credenciales incorrectas' };

        decryptAdmin(admin);

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

        const emailHash = hashField(body.email);
        const usernameHash = hashField(body.username);

        const existingByEmail = await adminRepo().findOne({ where: { emailHash } });
        if (existingByEmail) throw { statusCode: 400, message: 'El email ya está registrado' };

        const existingByUsername = await adminRepo().findOne({ where: { usernameHash } });
        if (existingByUsername) throw { statusCode: 400, message: 'El username ya está en uso' };

        await pendingRepo().delete({ emailHash });

        const hashedPassword = await bcrypt.hash(body.password, 12);
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        const expiresAt = new Date(Date.now() + CODE_EXPIRES_MIN * 60 * 1000);

        await pendingRepo().save(pendingRepo().create({
            username: encryptField(body.username),
            usernameHash,
            email: encryptField(body.email),
            emailHash,
            password: hashedPassword,
            code: encryptField(code),
            expiresAt,
            attempts: 0
        }));

        await sendVerificationEmail(body.email, code);
        logger.info(`Código de verificación enviado a ${emailHash}`);

        return { message: 'Código de verificación enviado al correo', verificationRequired: true };
    }

    async verifyCode(body: VerifyCodeRequest): Promise<{ admin: Partial<Admin>; token: string }> {
        const emailHash = hashField(body.email);
        const pending = await pendingRepo().findOne({ where: { emailHash } });

        if (!pending) throw { statusCode: 400, message: 'No hay un registro pendiente para este correo' };

        if (new Date() > pending.expiresAt) {
            await pendingRepo().delete({ id: pending.id });
            throw { statusCode: 400, message: 'El código ha expirado, vuelve a registrarte' };
        }

        if (pending.attempts >= MAX_ATTEMPTS) {
            await pendingRepo().delete({ id: pending.id });
            throw { statusCode: 400, message: 'Demasiados intentos fallidos, vuelve a registrarte', attemptsLeft: 0 };
        }

        const decryptedCode = decryptField(pending.code);
        if (decryptedCode !== body.code) {
            await pendingRepo().update(pending.id, { attempts: pending.attempts + 1 });
            const attemptsLeft = MAX_ATTEMPTS - (pending.attempts + 1);
            throw { statusCode: 400, message: 'Código incorrecto', attemptsLeft };
        }

        decryptPending(pending);

        const usernameHash = hashField(pending.username);

        const admin = adminRepo().create({
            username: encryptField(pending.username),
            usernameHash,
            email: encryptField(pending.email),
            emailHash,
            password: pending.password,
        });

        const saved = await adminRepo().save(admin);
        decryptAdmin(saved);
        await pendingRepo().delete({ id: pending.id });

        const token = this.generateToken(saved);
        return {
            admin: { id: saved.id, username: saved.username, email: saved.email },
            token
        };
    }

    async cancelVerification(email: string): Promise<void> {
        const emailHash = hashField(email);
        await pendingRepo().delete({ emailHash });
    }

    verifyToken(token: string): JwtPayload {
        return jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    }
}

export default new AuthService();
