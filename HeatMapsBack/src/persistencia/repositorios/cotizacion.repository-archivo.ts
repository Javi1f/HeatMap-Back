import fs from 'fs';
import { dirname, join } from 'path';
import { injectable } from 'tsyringe';
import {
    EstadoSolicitud,
    SolicitudCotizacion,
} from '../entidades/SolicitudCotizacion.entity';
import { nuevoUuid } from '../entidades/uuid';
import type { SolicitudCotizacionInsert } from './cotizacion.repository';

/**
 * @file cotizacion.repository-archivo.ts
 * @description Almacén de solicitudes de cotización: un JSON local.
 *
 * Cumple el mismo contrato que {@link CotizacionRepository} (TypeORM), pero
 * persiste en `datos-demo/solicitudes-cotizacion.json` en lugar de la tabla
 * `solicitud_cotizacion`. Es la única parte del sistema que no toca la base:
 * el módulo comercial se estrena sin pedir una migración en el despliegue y
 * sin una variable de entorno nueva, y el resto del sistema sigue con MySQL
 * como siempre.
 *
 * Qué NO cambia respecto al almacén de base:
 *  - El correo de contacto sigue llegando cifrado desde el servicio
 *    (`DbFieldCipher`) y se guarda tal cual: ni siquiera aquí duerme en
 *    claro.
 *  - Rutas, panel y auditoría son los mismos: solo cambia dónde duermen las
 *    filas.
 *
 * El camino a producción ya está construido: registrar `CotizacionRepository`
 * en el arranque y aplicar la migración
 * `bd/migraciones/2026-10-27-solicitud-cotizacion.sql`. A escala real este
 * archivo no escala, y no lo pretende.
 */

/**
 * Ruta del archivo del modo demo, dentro de la raíz del proyecto.
 *
 * Se resuelve desde `__dirname` y no desde el CWD porque quién lance el
 * proceso (npm, WebStorm, Docker) no cambia el destino. Tres niveles hacia
 * arriba aciertan igual en dev (`src/persistencia/repositorios`) que en
 * producción (`dist/persistencia/repositorios`), porque `dist` copia la
 * estructura de `src`.
 */
export const rutaSolicitudesArchivo = (): string =>
    join(__dirname, '..', '..', '..', 'datos-demo', 'solicitudes-cotizacion.json');

/** Una fila tal como vive en el archivo: igual que la entidad, fechas en ISO. */
type FilaEnArchivo = Omit<
    SolicitudCotizacion,
    'fechaCreacion' | 'fechaActualizacion'
> & {
    fechaCreacion: string;
    fechaActualizacion: string;
};

/**
 * Una fila en memoria: los campos públicos de la entidad, con las fechas
 * como `Date`. El servicio solo lee esos campos, así que le resulta
 * indistinguible de una fila leída de la base.
 */
export type FilaSolicitud = Omit<
    SolicitudCotizacion,
    'fechaCreacion' | 'fechaActualizacion'
> & {
    fechaCreacion: Date;
    fechaActualizacion: Date;
};

/** Del archivo a la memoria: las fechas vuelven a ser `Date`. */
const aFilaDeMemoria = (fila: FilaEnArchivo): FilaSolicitud => ({
    ...fila,
    fechaCreacion: new Date(fila.fechaCreacion),
    fechaActualizacion: new Date(fila.fechaActualizacion),
});

/** De la memoria al archivo: las fechas se congelan en ISO. */
const aFilaDeArchivo = (fila: FilaSolicitud): FilaEnArchivo => ({
    ...fila,
    fechaCreacion: fila.fechaCreacion.toISOString(),
    fechaActualizacion: fila.fechaActualizacion.toISOString(),
});

/** Contenido completo del archivo. */
interface AlmacenArchivo {
    /** Marca del formato, por si el archivo viaja o se inspecciona a mano. */
    formato: 'solicitudes-cotizacion';
    version: 1;
    solicitudes: FilaEnArchivo[];
}

/**
 * Lee el archivo del modo demo.
 *
 * Un archivo que no existe es un almacén vacío, no un error: la primera
 * solicitud lo crea. Un archivo corrupto sí revienta — mejor un 500 visible
 * que un almacén que se borra a sí mismo sin decir nada.
 */
export const leerSolicitudesArchivo = (ruta: string): FilaSolicitud[] => {
    if (!fs.existsSync(ruta)) return [];
    const almacen = JSON.parse(fs.readFileSync(ruta, 'utf8')) as AlmacenArchivo;
    return almacen.solicitudes.map(aFilaDeMemoria);
};

/**
 * Reemplaza el contenido completo del archivo.
 *
 * Escribe primero en un temporal y renombra: si el proceso muere a mitad de
 * escritura, queda el temporal a medio hacer y no un JSON inválido donde
 * había uno válido.
 */
export const escribirSolicitudesArchivo = (
    filas: FilaSolicitud[],
    ruta: string,
): void => {
    const almacen: AlmacenArchivo = {
        formato: 'solicitudes-cotizacion',
        version: 1,
        solicitudes: filas.map(aFilaDeArchivo),
    };
    fs.mkdirSync(dirname(ruta), { recursive: true });
    const temporal = `${ruta}.tmp`;
    fs.writeFileSync(temporal, `${JSON.stringify(almacen, null, 2)}\n`, 'utf8');
    fs.renameSync(temporal, ruta);
};

/**
 * Acceso a las solicitudes de cotización en modo demo.
 *
 * No descifra nada, igual que su hermano de TypeORM: el correo sale tal
 * cual se guardó, y el servicio decide si descifrarlo.
 */
@injectable()
export class CotizacionRepositoryArchivo {
    /** Archivo donde duermen las solicitudes. */
    private readonly ruta: string;

    constructor(ruta = rutaSolicitudesArchivo()) {
        this.ruta = ruta;
    }

    /** Persiste una solicitud nueva. */
    async create(datos: SolicitudCotizacionInsert): Promise<FilaSolicitud> {
        const ahora = new Date();
        const fila: FilaSolicitud = {
            idSolicitud: nuevoUuid(),
            estado: 'nueva',
            notasComerciales: null,
            ...datos,
            fechaCreacion: ahora,
            fechaActualizacion: ahora,
        };
        escribirSolicitudesArchivo(
            [...leerSolicitudesArchivo(this.ruta), fila],
            this.ruta,
        );
        return fila;
    }

    /**
     * Solicitudes, de la más reciente a la más antigua.
     *
     * @param estado - Filtra por estado del ciclo comercial; sin él, todas.
     */
    async findAll(estado?: EstadoSolicitud): Promise<FilaSolicitud[]> {
        return leerSolicitudesArchivo(this.ruta)
            .filter((fila) => !estado || fila.estado === estado)
            .sort((a, b) => b.fechaCreacion.getTime() - a.fechaCreacion.getTime());
    }

    /** Busca una solicitud por identificador. */
    async findById(idSolicitud: string): Promise<FilaSolicitud | null> {
        return (
            leerSolicitudesArchivo(this.ruta).find(
                (fila) => fila.idSolicitud === idSolicitud,
            ) ?? null
        );
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
        const filas = leerSolicitudesArchivo(this.ruta);
        const indice = filas.findIndex((fila) => fila.idSolicitud === idSolicitud);
        if (indice < 0) return false;
        filas[indice] = { ...filas[indice], ...cambios, fechaActualizacion: new Date() };
        escribirSolicitudesArchivo(filas, this.ruta);
        return true;
    }

    /**
     * Elimina una solicitud.
     *
     * @returns `true` si existía.
     */
    async deleteById(idSolicitud: string): Promise<boolean> {
        const filas = leerSolicitudesArchivo(this.ruta);
        const restantes = filas.filter((fila) => fila.idSolicitud !== idSolicitud);
        if (restantes.length === filas.length) return false;
        escribirSolicitudesArchivo(restantes, this.ruta);
        return true;
    }
}
