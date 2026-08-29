import { injectable } from 'tsyringe';
import { AdminRepository } from '../auth/repositories/admin.repository';
import { SessionService } from '../auth/services/session.service';
import { DbFieldCipher } from '../../crypto/db-field.crypto';
import { NotFoundError } from '../../common/errors';

/** Administrador tal como se muestra en el panel de gestión de usuarios. */
export interface AdminSummary {
    /** Identificador de la cuenta. */
    id: number;

    /** Nombre de usuario ya descifrado. */
    username: string;

    /** Correo ya descifrado. */
    email: string;

    /** `true` si completo la verificacion por correo. */
    isVerified: boolean;

    /** Alta de la cuenta, en ISO. */
    createdAt: string;

    /** `true` si el administrador tiene al menos una sesión viva. */
    conSesionActiva: boolean;
}

/** Sesión tal como se muestra en el panel. */
export interface SessionSummary {
    /** Identificador de la sesion, necesario para revocarla. */
    idSesion: string;

    /** Cuenta titular de la sesion. */
    idAdmin: number;

    /** Username del titular, o `null` si la cuenta ya no existe. */
    username: string | null;
    /** IP desde la que se inicio, o `null` si no se registro. */
    ipOrigen: string | null;

    /** Inicio de sesion, en ISO. */
    fechaInicio: string;

    /** Momento en que el token deja de ser valido, en ISO. */
    fechaExpiracion: string;
    /** `true` si es la sesión desde la que se está consultando. */
    esActual: boolean;
}

/**
 * Consultas de la sección de administración de usuarios.
 *
 * Los campos `username` y `email` están cifrados en la base de datos, así que
 * el descifrado ocurre aquí, en el borde de la aplicación, y nunca se expone
 * la entidad cruda.
 */
@injectable()
export class UsersService {
    constructor(
        private readonly admins: AdminRepository,
        private readonly sessions: SessionService,
        private readonly cipher: DbFieldCipher,
    ) {}

    /**
     * Lista los administradores registrados.
     *
     * @param currentToken - Token de quien consulta, para marcar su sesión.
     */
    async listAdmins(): Promise<AdminSummary[]> {
        const [admins, activeSessions] = await Promise.all([
            this.admins.findAll(),
            this.sessions.listActive(),
        ]);

        const conSesion = new Set(activeSessions.map((s) => s.idAdmin));

        return admins.map((admin) => ({
            id: admin.id,
            username: this.cipher.decrypt(admin.username),
            email: this.cipher.decrypt(admin.email),
            isVerified: admin.isVerified,
            createdAt: admin.createdAt.toISOString(),
            conSesionActiva: conSesion.has(admin.id),
        }));
    }

    /**
     * Lista las sesiones vivas, resolviendo el username de cada titular.
     */
    async listSessions(currentToken?: string): Promise<SessionSummary[]> {
        const [sesiones, admins] = await Promise.all([
            this.sessions.listActive(),
            this.admins.findAll(),
        ]);

        const nombres = new Map(
            admins.map((a) => [a.id, this.cipher.decrypt(a.username)] as const),
        );
        const currentHash = currentToken ? this.sessions.fingerprint(currentToken) : null;

        return sesiones.map((s) => ({
            idSesion: s.idSesion,
            idAdmin: s.idAdmin,
            username: nombres.get(s.idAdmin) ?? null,
            ipOrigen: s.ipOrigen,
            fechaInicio: s.fechaInicio.toISOString(),
            fechaExpiracion: s.fechaExpiracion.toISOString(),
            esActual: currentHash !== null && s.tokenHash === currentHash,
        }));
    }

    /**
     * Revoca una sesión ajena o propia.
     *
     * @throws NotFoundError si la sesión no existe o ya estaba revocada.
     */
    async revokeSession(idSesion: string): Promise<void> {
        const ok = await this.sessions.revoke(idSesion);
        if (!ok) throw new NotFoundError('La sesión no existe o ya estaba cerrada');
    }
}
