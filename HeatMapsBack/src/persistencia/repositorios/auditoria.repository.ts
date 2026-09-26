import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { DatabaseConfig } from '../../config/database.config';
import { EventoAuditoria, TipoEventoAuditoria } from '../entidades/EventoAuditoria.entity';

/** Fila nueva de auditoría, ya recortada a sus columnas. */
export interface EventoAuditoriaInsert {
    tipo: TipoEventoAuditoria;
    idAdmin: string | null;
    detalle: string | null;
    ipOrigen: string | null;
}

/**
 * Acceso a la tabla de auditoría de acciones administrativas.
 */
@injectable()
export class AuditoriaRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<EventoAuditoria>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(EventoAuditoria);
    }

    /** Guarda un evento. */
    async insertar(evento: EventoAuditoriaInsert): Promise<void> {
        await this.repo.insert(evento);
    }

    /** Últimos eventos, del más reciente al más antiguo. */
    ultimos(limite: number): Promise<EventoAuditoria[]> {
        return this.repo.find({ order: { fecha: 'DESC' }, take: limite });
    }
}
