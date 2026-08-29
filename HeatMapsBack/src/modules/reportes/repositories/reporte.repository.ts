import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Reporte } from '../../../models/Reporte.entity';
import { DatabaseConfig } from '../../../config/database.config';

/** Fila lista para insertar en `reporte`. */
export interface ReporteInsert {
    /** Administrador que lo genera. */
    idAdmin: number;

    /** Zona a la que se acota, o `null` si abarca todas. */
    idZona: string | null;

    /** Clase de reporte. */
    tipoReporte: string;

    /** Inicio del rango consultado. */
    rangoInicio: Date;

    /** Fin del rango consultado. */
    rangoFin: Date;

    /** Filtros con los que se pidió, para poder reproducirlo. */
    parametros: Record<string, unknown> | null;
}

/**
 * Acceso a las definiciones de reporte guardadas.
 *
 * Guarda la definición, nunca el resultado: los datos se recalculan al abrir
 * el reporte, de modo que refleja siempre el estado actual del histórico en
 * lugar de una foto que envejece.
 */
@injectable()
export class ReporteRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Reporte>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Reporte);
    }

    /** Persiste una definición de reporte. */
    create(data: ReporteInsert): Promise<Reporte> {
        return this.repo.save(this.repo.create(data));
    }

    /** Definiciones guardadas, de la más reciente a la más antigua. */
    findAll(): Promise<Reporte[]> {
        return this.repo.find({
            relations: { zona: true },
            order: { fechaGeneracion: 'DESC' },
        });
    }

    /** Busca una definición por identificador. */
    findById(idReporte: string): Promise<Reporte | null> {
        return this.repo.findOne({
            where: { idReporte },
            relations: { zona: true },
        });
    }

    /**
     * Elimina una definición.
     *
     * @returns `true` si existía.
     */
    async deleteById(idReporte: string): Promise<boolean> {
        const result = await this.repo.delete({ idReporte });
        return (result.affected ?? 0) > 0;
    }
}
