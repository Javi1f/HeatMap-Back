import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import {
    EstadoSolicitud,
    SolicitudCotizacion,
} from '../entidades/SolicitudCotizacion.entity';
import { DatabaseConfig } from '../../config/database.config';

/** Datos listos para insertar en `solicitud_cotizacion`. */
export interface SolicitudCotizacionInsert {
    tipoRecinto: SolicitudCotizacion['tipoRecinto'];
    organizacion: string;
    nombreContacto: string;
    /** Ya viene cifrado: el repositorio no conoce la clave. */
    correoContacto: string;
    telefonoContacto: string | null;
    areaM2: number;
    aforoMinimo: number;
    aforoMaximo: number;
    eventosAnuales: number;
    datos: Record<string, unknown>;
    estimacion: Record<string, unknown>;
    ipOrigen: string | null;
}

/**
 * Acceso a las solicitudes de cotización.
 *
 * No descifra nada: el correo sale tal cual se guardó, y es el servicio quien
 * decide descifrarlo al armar la respuesta del panel.
 */
@injectable()
export class CotizacionRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<SolicitudCotizacion>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(SolicitudCotizacion);
    }

    /** Persiste una solicitud nueva. */
    create(datos: SolicitudCotizacionInsert): Promise<SolicitudCotizacion> {
        return this.repo.save(this.repo.create(datos));
    }

    /**
     * Solicitudes, de la más reciente a la más antigua.
     *
     * @param estado - Filtra por estado del ciclo comercial; sin él, todas.
     */
    findAll(estado?: EstadoSolicitud): Promise<SolicitudCotizacion[]> {
        return this.repo.find({
            where: estado ? { estado } : {},
            order: { fechaCreacion: 'DESC' },
        });
    }

    /** Busca una solicitud por identificador. */
    findById(idSolicitud: string): Promise<SolicitudCotizacion | null> {
        return this.repo.findOne({ where: { idSolicitud } });
    }

    /**
     * Cambia el estado y las notas de una solicitud.
     *
     * @returns `true` si existía.
     */
    async actualizar(
        idSolicitud: string,
        cambios: Partial<Pick<SolicitudCotizacion, 'estado' | 'notasComerciales'>>,
    ): Promise<boolean> {
        const result = await this.repo.update({ idSolicitud }, cambios);
        return (result.affected ?? 0) > 0;
    }

    /**
     * Elimina una solicitud.
     *
     * @returns `true` si existía.
     */
    async deleteById(idSolicitud: string): Promise<boolean> {
        const result = await this.repo.delete({ idSolicitud });
        return (result.affected ?? 0) > 0;
    }
}
