import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Zona } from '../../../models/Zona.entity';
import { DatabaseConfig } from '../../../config/database.config';

/** Nombre de la zona a la que caen los sensores aún no asignados. */
export const ZONA_SIN_ASIGNAR = 'Sin asignar';

/**
 * Acceso a las zonas monitorizadas.
 */
@injectable()
export class ZonaRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Zona>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Zona);
    }

    /** Todas las zonas, activas o no, ordenadas por nombre. */
    findAll(): Promise<Zona[]> {
        return this.repo.find({ order: { nombre: 'ASC' } });
    }

    /** Solo las zonas activas, que son las que entran en las metricas. */
    findActive(): Promise<Zona[]> {
        return this.repo.find({ where: { activa: true }, order: { nombre: 'ASC' } });
    }

    /** Busca una zona por identificador. */
    findById(idZona: string): Promise<Zona | null> {
        return this.repo.findOne({ where: { idZona } });
    }

    /**
     * Devuelve la zona comodín donde aterrizan los sensores que publican sin
     * haber sido registrados por un administrador, creándola si aún no existe.
     *
     * Sin esto, la clave foránea de `captura` obligaría a descartar las
     * lecturas de cualquier nodo nuevo — es preferible ingerirlas y que el
     * administrador reasigne la zona después que perder los datos.
     */
    async findOrCreateDefault(): Promise<Zona> {
        const existing = await this.repo.findOne({ where: { nombre: ZONA_SIN_ASIGNAR } });
        if (existing) return existing;

        return this.repo.save(
            this.repo.create({
                nombre: ZONA_SIN_ASIGNAR,
                descripcion:
                    'Zona por defecto para nodos de captura que aún no han sido asignados a un espacio.',
                capacidadMax: null,
                activa: true,
            }),
        );
    }
}
