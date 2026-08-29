import { injectable } from 'tsyringe';
import { NotFoundError } from '../../common/errors';
import { Reporte } from '../../models/Reporte.entity';
import { AlertaRepository } from '../sensor/repositories/alerta.repository';
import { OcupacionRepository } from '../sensor/repositories/ocupacion.repository';
import { ZonaRepository } from '../sensor/repositories/zona.repository';
import { CrearReporteDto, TipoReporte } from './dto/reporte.dto';
import { ReporteRepository } from './repositories/reporte.repository';

/** Definición de reporte tal como se muestra en el listado. */
export interface ReporteResumen {
    /** Identificador del reporte. */
    idReporte: string;

    /** Clase de reporte. */
    tipoReporte: string;

    /** Nombre de la zona, o `null` si abarca todas. */
    zona: string | null;

    /** Inicio del rango, en ISO. */
    rangoInicio: string;

    /** Fin del rango, en ISO. */
    rangoFin: string;

    /** Momento en que se guardó la definición, en ISO. */
    fechaGeneracion: string;
}

/**
 * Reporte con sus datos ya calculados.
 *
 * `columnas` y `filas` van juntas y en el mismo orden para que el cliente
 * pueda pintar la tabla sin conocer de antemano la forma de cada tipo de
 * reporte, y para que el CSV se derive sin lógica adicional.
 */
export interface ReporteGenerado extends ReporteResumen {
    /** Cabeceras de la tabla, en orden. */
    columnas: string[];

    /** Filas de datos, alineadas con `columnas`. */
    filas: (string | number)[][];

    /** Número de filas, para mostrarlo sin recorrer el array. */
    total: number;
}

/**
 * Genera y administra los reportes de ocupación.
 *
 * **Qué se guarda y qué no**: se persiste la *definición* del reporte (rango,
 * zona, tipo), nunca su resultado. Los datos se recalculan cada vez que se
 * abre. Así un reporte guardado en septiembre y consultado en noviembre
 * refleja el histórico tal como está entonces, incluida cualquier corrección
 * posterior, en lugar de una foto congelada que nadie puede auditar.
 */
@injectable()
export class ReportesService {
    constructor(
        private readonly reportes: ReporteRepository,
        private readonly ocupacion: OcupacionRepository,
        private readonly alertas: AlertaRepository,
        private readonly zonas: ZonaRepository,
    ) {}

    /**
     * Guarda una definición de reporte y devuelve su primer cálculo.
     *
     * El cálculo se hace releyendo la fila recién guardada, no con el objeto en
     * memoria. Parece un rodeo y es deliberado: las columnas del rango son
     * `DATETIME` sin fracción de segundo, así que al persistirse se truncan.
     * Calcular con la fecha en memoria daría un resultado distinto al de abrir
     * ese mismo reporte después, y un reporte que cambia según por dónde se
     * mire no sirve para sustentar nada.
     *
     * @param dto     - Tipo, rango y zona solicitados.
     * @param idAdmin - Administrador que lo genera.
     * @throws NotFoundError si la zona indicada no existe.
     */
    async crear(dto: CrearReporteDto, idAdmin: number): Promise<ReporteGenerado> {
        if (dto.idZona) {
            const zona = await this.zonas.findById(dto.idZona);
            if (!zona) throw new NotFoundError('La zona indicada no existe');
        }

        const reporte = await this.reportes.create({
            idAdmin,
            idZona: dto.idZona ?? null,
            tipoReporte: dto.tipoReporte,
            rangoInicio: dto.rangoInicio,
            rangoFin: dto.rangoFin,
            parametros: { tipoReporte: dto.tipoReporte, idZona: dto.idZona ?? null },
        });

        return this.obtener(reporte.idReporte);
    }

    /** Definiciones guardadas, sin calcular sus datos. */
    async listar(): Promise<ReporteResumen[]> {
        const filas = await this.reportes.findAll();
        return filas.map((r) => this.resumir(r));
    }

    /**
     * Recupera un reporte y recalcula sus datos.
     *
     * @throws NotFoundError si no existe.
     */
    async obtener(idReporte: string): Promise<ReporteGenerado> {
        const reporte = await this.reportes.findById(idReporte);
        if (!reporte) throw new NotFoundError('El reporte no existe');
        return this.calcular(reporte);
    }

    /**
     * Elimina una definición de reporte.
     *
     * @throws NotFoundError si no existe.
     */
    async eliminar(idReporte: string): Promise<void> {
        const borrado = await this.reportes.deleteById(idReporte);
        if (!borrado) throw new NotFoundError('El reporte no existe');
    }

    /**
     * Exporta un reporte como CSV.
     *
     * Devuelve el contenido como texto en lugar de escribirlo en la respuesta
     * HTTP: así viaja por el mismo canal cifrado que el resto de la API y el
     * cliente construye la descarga, sin necesidad de exceptuar esta ruta del
     * middleware de cifrado.
     *
     * @returns Nombre de archivo sugerido y contenido del CSV.
     */
    async exportarCsv(idReporte: string): Promise<{ nombreArchivo: string; contenido: string }> {
        const reporte = await this.obtener(idReporte);

        const lineas = [
            aCsv(reporte.columnas),
            ...reporte.filas.map((fila) => aCsv(fila)),
        ];

        const fecha = reporte.rangoInicio.slice(0, 10);
        return {
            nombreArchivo: `${reporte.tipoReporte}_${fecha}.csv`,
            // El BOM hace que Excel abra el archivo como UTF-8; sin él,
            // destroza los acentos de los nombres de zona.
            contenido: '﻿' + lineas.join('\r\n') + '\r\n',
        };
    }

    /** Proyecta la entidad a la vista de listado. */
    private resumir(r: Reporte): ReporteResumen {
        return {
            idReporte: r.idReporte,
            tipoReporte: r.tipoReporte,
            zona: r.zona?.nombre ?? null,
            rangoInicio: r.rangoInicio.toISOString(),
            rangoFin: r.rangoFin.toISOString(),
            fechaGeneracion: r.fechaGeneracion.toISOString(),
        };
    }

    /** Ejecuta la consulta que corresponde al tipo del reporte. */
    private async calcular(r: Reporte): Promise<ReporteGenerado> {
        const base = this.resumir(r);
        const { columnas, filas } = await this.datos(
            r.tipoReporte as TipoReporte,
            r.rangoInicio,
            r.rangoFin,
            r.idZona,
        );
        return { ...base, columnas, filas, total: filas.length };
    }

    /**
     * Obtiene columnas y filas según el tipo.
     *
     * Cada rama devuelve ya el dato formateado para presentar: el cliente y el
     * CSV comparten exactamente la misma tabla, así que no pueden divergir.
     */
    private async datos(
        tipo: TipoReporte,
        inicio: Date,
        fin: Date,
        idZona: string | null,
    ): Promise<{ columnas: string[]; filas: (string | number)[][] }> {
        if (tipo === 'resumen_por_zona') {
            const resumen = await this.ocupacion.summaryByZone(inicio, fin, idZona);
            return {
                columnas: [
                    'Zona',
                    'Ventanas',
                    'Promedio únicos',
                    'Pico únicos',
                    'Promedio estables',
                    'Ventanas en nivel alto',
                ],
                filas: resumen.map((z) => [
                    z.nombre,
                    z.ventanas,
                    z.promedioUnicos,
                    z.picoUnicos,
                    z.promedioEstables,
                    z.ventanasAltas,
                ]),
            };
        }

        if (tipo === 'alertas') {
            const alertas = await this.alertas.findByRange(inicio, fin, idZona);
            return {
                columnas: ['Fecha', 'Zona', 'Nivel', 'Mensaje', 'Estado'],
                filas: alertas.map((a) => [
                    a.timestampAlerta.toISOString(),
                    a.zona?.nombre ?? '—',
                    a.nivel,
                    a.mensaje,
                    a.resuelta ? 'Resuelta' : 'Abierta',
                ]),
            };
        }

        const ventanas = await this.ocupacion.findByRange(inicio, fin, idZona);
        return {
            columnas: ['Inicio de ventana', 'Zona', 'Únicos', 'Estables', 'RSSI medio', 'Nivel'],
            filas: ventanas.map((o) => [
                o.intervaloInicio.toISOString(),
                o.zona?.nombre ?? '—',
                o.dispositivosUnicos,
                o.dispositivosEstables,
                o.rssiPromedio ?? '',
                o.nivelOcupacion,
            ]),
        };
    }
}

/**
 * Serializa una fila a CSV.
 *
 * Entrecomilla siempre y duplica las comillas internas. Es la única forma de
 * que un mensaje de alerta que contenga una coma o un salto de línea no parta
 * la fila en dos al abrir el archivo.
 *
 * Se exporta únicamente para poder probarla de forma aislada: el escapado es
 * la parte del módulo con reglas propias y merece cobertura directa.
 */
export const aCsv = (valores: (string | number)[]): string =>
    valores.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
