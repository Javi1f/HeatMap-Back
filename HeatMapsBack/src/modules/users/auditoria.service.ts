import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { DatabaseConfig } from '../../config/database.config';
import { LoggerService } from '../../common/logger/logger.service';
import { EventoAuditoria, TipoEventoAuditoria } from '../../models/EventoAuditoria.entity';

/** Datos de un evento por registrar. */
export interface NuevoEvento {
    /** Acción realizada. */
    tipo: TipoEventoAuditoria;

    /** Administrador que actuó, si se conoce. */
    idAdmin?: number | null;

    /** Contexto sin datos personales. */
    detalle?: string | null;

    /** IP de origen. */
    ip?: string | null;
}

/** Evento tal como se devuelve al panel. */
export interface EventoAuditoriaResumen {
    /** Identificador del evento. */
    id: string;

    /** Momento del evento, en ISO. */
    fecha: string;

    /** Administrador que actuó. */
    idAdmin: number | null;

    /** Acción realizada. */
    tipo: TipoEventoAuditoria;

    /** Contexto. */
    detalle: string | null;

    /** IP de origen. */
    ipOrigen: string | null;
}

/**
 * Registro y consulta de la auditoría de acciones administrativas.
 */
@injectable()
export class AuditoriaService {
    /** Repositorio TypeORM de los eventos. */
    private readonly repo: Repository<EventoAuditoria>;

    constructor(
        db: DatabaseConfig,
        private readonly logger: LoggerService,
    ) {
        this.repo = db.dataSource.getRepository(EventoAuditoria);
    }

    /**
     * Registra un evento.
     *
     * Nunca lanza: si la auditoría falla se deja constancia en el registro del
     * servidor, pero la acción del administrador, que ya se completó, no debe
     * devolver un error por ello.
     */
    async registrar(evento: NuevoEvento): Promise<void> {
        try {
            await this.repo.insert({
                tipo: evento.tipo,
                idAdmin: evento.idAdmin ?? null,
                detalle: evento.detalle?.slice(0, 255) ?? null,
                ipOrigen: evento.ip?.slice(0, 45) ?? null,
            });
        } catch (err) {
            this.logger.error(`No se pudo registrar el evento de auditoría ${evento.tipo}`, err);
        }
    }

    /**
     * Últimos eventos, del más reciente al más antiguo.
     *
     * @param limite - Máximo de eventos a devolver.
     */
    async listar(limite: number): Promise<EventoAuditoriaResumen[]> {
        const eventos = await this.repo.find({ order: { fecha: 'DESC' }, take: limite });
        return eventos.map((evento) => ({
            id: evento.idEvento,
            fecha: evento.fecha.toISOString(),
            idAdmin: evento.idAdmin,
            tipo: evento.tipo,
            detalle: evento.detalle,
            ipOrigen: evento.ipOrigen,
        }));
    }
}
