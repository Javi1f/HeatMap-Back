import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { NivelOcupacion, OcupacionAgregada } from '../../../models/OcupacionAgregada.entity';
import { Captura } from '../../../models/Captura.entity';
import { Sensor } from '../../../models/Sensor.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Fila lista para insertar en `ocupacion_agregada`. Ver la nota de
 * `CapturaInsert` sobre por qué no se usa `Partial<Entity>`.
 */
export interface OcupacionInsert {
    /** Zona consolidada. */
    idZona: string;

    /** Inicio de la ventana, inclusivo. */
    intervaloInicio: Date;

    /** Fin de la ventana, exclusivo. */
    intervaloFin: Date;

    /** MAC distintas contadas en la ventana. */
    dispositivosUnicos: number;

    /** Subconjunto con MAC de fabricante. */
    dispositivosEstables: number;

    /** RSSI medio de la ventana, en dBm. */
    rssiPromedio: number | null;

    /** Nivel derivado del conteo frente al aforo. */
    nivelOcupacion: NivelOcupacion;
}

/** Fila agregada de una zona en todo el rango de un reporte. */
export interface ResumenZona {
    /** Zona resumida. */
    idZona: string;

    /** Nombre legible del espacio. */
    nombre: string;

    /** Ventanas consolidadas dentro del rango. */
    ventanas: number;

    /** Media de dispositivos únicos entre esas ventanas. */
    promedioUnicos: number;

    /** Mayor conteo de únicos alcanzado en el rango. */
    picoUnicos: number;

    /** Media de dispositivos estables. */
    promedioEstables: number;

    /** Ventanas que alcanzaron nivel alto. */
    ventanasAltas: number;
}

/** Conteo crudo de una zona dentro de una ventana, antes de clasificar nivel. */
export interface ConteoZona {
    /** Zona a la que corresponde el conteo. */
    idZona: string;

    /** MAC distintas vistas en la ventana. */
    dispositivosUnicos: number;

    /** Subconjunto con MAC de fabricante. */
    dispositivosEstables: number;

    /** Media aritmetica del RSSI, sin redondear. */
    rssiPromedio: number | null;
}

/**
 * Acceso a la ocupación consolidada por zona e intervalo.
 */
@injectable()
export class OcupacionRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<OcupacionAgregada>;

    constructor(private readonly db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(OcupacionAgregada);
    }

    /**
     * Consolida las detecciones de una ventana agrupadas por zona.
     *
     * `dispositivosEstables` cuenta solo las MAC de fabricante: dentro de una
     * misma ventana una MAC aleatorizada puede rotar y contarse varias veces,
     * así que el conteo estable es el suelo fiable y el único el techo.
     *
     * Las tablas se referencian por su clase de entidad y no por su nombre en
     * texto: así TypeORM dispone de los metadatos para traducir cada propiedad
     * a su columna real. Con nombres de tabla en crudo no hay traducción
     * posible y la consulta se rompería al cambiar el nombre de una columna.
     *
     * @param start - Inicio de la ventana, inclusivo.
     * @param end   - Fin de la ventana, exclusivo.
     */
    async aggregateWindow(start: Date, end: Date): Promise<ConteoZona[]> {
        const rows = await this.db.dataSource
            .createQueryBuilder()
            .select('s.idZona', 'idZona')
            .addSelect('COUNT(DISTINCT c.macHash)', 'dispositivosUnicos')
            .addSelect(
                'COUNT(DISTINCT CASE WHEN c.esMacRandom = 0 THEN c.macHash END)',
                'dispositivosEstables',
            )
            .addSelect('AVG(c.rssi)', 'rssiPromedio')
            .from(Captura, 'c')
            .innerJoin(Sensor, 's', 's.idSensor = c.idSensor')
            .where('c.timestampCaptura >= :start AND c.timestampCaptura < :end', { start, end })
            .groupBy('s.idZona')
            .getRawMany<{
                idZona: string;
                dispositivosUnicos: string;
                dispositivosEstables: string;
                rssiPromedio: string | null;
            }>();

        return rows.map((r) => ({
            idZona: r.idZona,
            dispositivosUnicos: Number(r.dispositivosUnicos),
            dispositivosEstables: Number(r.dispositivosEstables),
            rssiPromedio: r.rssiPromedio === null ? null : Number(r.rssiPromedio),
        }));
    }

    /** Persiste las filas consolidadas de una ventana. */
    async insertMany(rows: OcupacionInsert[]): Promise<void> {
        if (rows.length === 0) return;
        await this.repo.insert(rows);
    }

    /**
     * @returns `true` si esa ventana ya fue consolidada, para no duplicar
     *          filas si el proceso se reinicia dentro del mismo intervalo.
     */
    async windowExists(intervaloInicio: Date): Promise<boolean> {
        return (await this.repo.count({ where: { intervaloInicio } })) > 0;
    }

    /** Última consolidación de cada zona, para el estado actual del dashboard. */
    findLatestPerZone(): Promise<OcupacionAgregada[]> {
        return this.repo
            .createQueryBuilder('o')
            .innerJoin(
                (qb) =>
                    qb
                        .select('x.idZona', 'idZona')
                        .addSelect('MAX(x.intervaloInicio)', 'maxInicio')
                        .from(OcupacionAgregada, 'x')
                        .groupBy('x.idZona'),
                'ultima',
                'ultima.idZona = o.idZona AND ultima.maxInicio = o.intervaloInicio',
            )
            .leftJoinAndSelect('o.zona', 'zona')
            .getMany();
    }

    /**
     * Ventanas consolidadas dentro de un rango cerrado, para los reportes.
     *
     * Se diferencia de `findSeries` en que acota por ambos extremos: un
     * reporte describe un periodo concreto, no «lo ocurrido desde».
     *
     * @param inicio - Comienzo del rango, inclusivo.
     * @param fin    - Final del rango, inclusivo.
     * @param idZona - Acota a una zona; omitido devuelve todas.
     */
    findByRange(inicio: Date, fin: Date, idZona?: string | null): Promise<OcupacionAgregada[]> {
        const qb = this.repo
            .createQueryBuilder('o')
            .leftJoinAndSelect('o.zona', 'zona')
            .where('o.intervaloInicio >= :inicio AND o.intervaloInicio <= :fin', { inicio, fin })
            .orderBy('o.intervaloInicio', 'ASC');

        if (idZona) qb.andWhere('o.idZona = :idZona', { idZona });

        return qb.getMany();
    }

    /**
     * Resumen por zona de todo un rango: una fila por espacio.
     *
     * Devuelve promedio y pico en la misma consulta porque un reporte de uso
     * necesita ambos para ser interpretable: el promedio dice cómo se usó el
     * espacio de forma habitual, y el pico si llegó a saturarse.
     *
     * @param inicio - Comienzo del rango, inclusivo.
     * @param fin    - Final del rango, inclusivo.
     * @param idZona - Acota a una zona; omitido resume todas.
     */
    async summaryByZone(inicio: Date, fin: Date, idZona?: string | null): Promise<ResumenZona[]> {
        const qb = this.repo
            .createQueryBuilder('o')
            .innerJoin('o.zona', 'z')
            .select('o.idZona', 'idZona')
            .addSelect('z.nombre', 'nombre')
            .addSelect('COUNT(*)', 'ventanas')
            .addSelect('AVG(o.dispositivosUnicos)', 'promedioUnicos')
            .addSelect('MAX(o.dispositivosUnicos)', 'picoUnicos')
            .addSelect('AVG(o.dispositivosEstables)', 'promedioEstables')
            .addSelect(
                "SUM(CASE WHEN o.nivelOcupacion = 'alta' THEN 1 ELSE 0 END)",
                'ventanasAltas',
            )
            .where('o.intervaloInicio >= :inicio AND o.intervaloInicio <= :fin', { inicio, fin })
            .groupBy('o.idZona')
            .addGroupBy('z.nombre')
            .orderBy('promedioUnicos', 'DESC');

        if (idZona) qb.andWhere('o.idZona = :idZona', { idZona });

        const filas = await qb.getRawMany<{
            idZona: string;
            nombre: string;
            ventanas: string;
            promedioUnicos: string;
            picoUnicos: string;
            promedioEstables: string;
            ventanasAltas: string;
        }>();

        return filas.map((f) => ({
            idZona: f.idZona,
            nombre: f.nombre,
            ventanas: Number(f.ventanas),
            promedioUnicos: Math.round(Number(f.promedioUnicos) * 100) / 100,
            picoUnicos: Number(f.picoUnicos),
            promedioEstables: Math.round(Number(f.promedioEstables) * 100) / 100,
            ventanasAltas: Number(f.ventanasAltas),
        }));
    }

    /** Serie temporal de una zona (o de todas) desde una fecha dada. */
    findSeries(since: Date, idZona?: string): Promise<OcupacionAgregada[]> {
        const qb = this.repo
            .createQueryBuilder('o')
            .where('o.intervaloInicio >= :since', { since })
            .orderBy('o.intervaloInicio', 'ASC');

        if (idZona) qb.andWhere('o.idZona = :idZona', { idZona });

        return qb.getMany();
    }
}
