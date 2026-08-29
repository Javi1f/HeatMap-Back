import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Alerta, NivelAlerta } from '../../../models/Alerta.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Acceso a las alertas de aglomeración.
 */
@injectable()
export class AlertaRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Alerta>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Alerta);
    }

    /** Alertas abiertas, de la más reciente a la más antigua. */
    findUnresolved(): Promise<Alerta[]> {
        return this.repo.find({
            where: { resuelta: false },
            relations: { zona: true },
            order: { timestampAlerta: 'DESC' },
        });
    }

    /** Numero de alertas abiertas, para la tarjeta del dashboard. */
    countUnresolved(): Promise<number> {
        return this.repo.count({ where: { resuelta: false } });
    }

    /**
     * Alertas levantadas dentro de un rango, resueltas o no.
     *
     * Un reporte de alertas incluye también las ya cerradas: sirve para
     * contrastar los avisos emitidos frente a los eventos observados, que es
     * uno de los mecanismos de validación del proyecto.
     *
     * @param inicio - Comienzo del rango, inclusivo.
     * @param fin    - Final del rango, inclusivo.
     * @param idZona - Acota a una zona; omitido devuelve todas.
     */
    findByRange(inicio: Date, fin: Date, idZona?: string | null): Promise<Alerta[]> {
        const qb = this.repo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.zona', 'zona')
            .where('a.timestampAlerta >= :inicio AND a.timestampAlerta <= :fin', { inicio, fin })
            .orderBy('a.timestampAlerta', 'DESC');

        if (idZona) qb.andWhere('a.idZona = :idZona', { idZona });

        return qb.getMany();
    }

    /** @returns `true` si la zona ya tiene una alerta abierta. */
    async hasOpenForZone(idZona: string): Promise<boolean> {
        return (await this.repo.count({ where: { idZona, resuelta: false } })) > 0;
    }

    /**
     * Levanta una alerta nueva.
     *
     * @param idZona  - Zona afectada.
     * @param nivel   - Gravedad asignada.
     * @param mensaje - Texto con el conteo y el aforo que la motivaron.
     */
    create(idZona: string, nivel: NivelAlerta, mensaje: string): Promise<Alerta> {
        return this.repo.save(this.repo.create({ idZona, nivel, mensaje, resuelta: false }));
    }

    /** Marca una alerta como resuelta. @returns `true` si existía y estaba abierta. */
    async resolve(idAlerta: string, resueltaPor: string): Promise<boolean> {
        const result = await this.repo.update(
            { idAlerta, resuelta: false },
            { resuelta: true, resueltaPor },
        );
        return (result.affected ?? 0) > 0;
    }
}
