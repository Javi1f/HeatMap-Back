/**
 * @file cotizacion.service.ts
 * @description Ciclo comercial de las solicitudes de cotización.
 *
 * Al llegar una solicitud: calcula la estimación (el cliente ya la vio en
 * vivo, y aquí se congela la misma), guarda el documento tal cual llegó y
 * responde con el identificador. Al gestionarla: lista, abre, mueve el
 * estado con notas y borra, dejando rastro en la auditoría.
 *
 * El correo de contacto se descifra solo aquí, y solo para el detalle que
 * ve el panel: el listado y el documento JSON conservado no lo necesitan.
 */

import { injectable } from 'tsyringe';
import { NotFoundError } from '../../common/errors';
import { LoggerService } from '../../common/logger/logger.service';
import { DbFieldCipher } from '../../crypto/db-field.crypto';
import { AuditoriaService } from '../identidad/usuarios/auditoria.service';
import type { EstadoSolicitud, SolicitudCotizacion } from '../../persistencia/entidades/SolicitudCotizacion.entity';
import { CotizacionRepository } from '../../persistencia/repositorios/cotizacion.repository';
import { CrearSolicitudDto } from './cotizacion.dto';
import { estimarNodos, EstimacionCotizacion } from './estimacion';

/** Versión del formato del documento conservado. */
const VERSION_DOCUMENTO = 1;

/** Resumen de una solicitud tal como llega al listado del panel. */
export interface SolicitudResumen {
    idSolicitud: string;
    tipoRecinto: string;
    organizacion: string;
    nombreContacto: string;
    areaM2: number;
    aforoMinimo: number;
    aforoMaximo: number;
    eventosAnuales: number;
    /** Nodos que estimó la solicitud. */
    nodos: number;
    estado: EstadoSolicitud;
    fechaCreacion: string;
}

/** Solicitud abierta en el panel, con el contacto descifrado. */
export interface SolicitudDetalle extends SolicitudResumen {
    /** Correo descifrado: solo el detalle del panel lo necesita. */
    correoContacto: string;
    telefonoContacto: string | null;
    /** Documento tal cual llegó el cliente, sin el correo. */
    datos: Record<string, unknown>;
    /** Estimación congelada que se le mostró. */
    estimacion: EstimacionCotizacion;
    notasComerciales: string | null;
    ipOrigen: string | null;
}

/** Respuesta al visitante que acaba de enviar su solicitud. */
export interface SolicitudCreada {
    idSolicitud: string;
    estimacion: EstimacionCotizacion;
}

/** Documento .json de una solicitud, tal como lo descarga el panel. */
export interface DocumentoSolicitud {
    idSolicitud: string;
    /** Marca del formato, por si el archivo viaja a otro sistema. */
    version: number;
    recibida: string;
    estado: EstadoSolicitud;
    /** Solicitud del cliente sin el correo: vive cifrado en la base. */
    solicitud: Record<string, unknown>;
    estimacion: EstimacionCotizacion;
    notasComerciales: string | null;
}

/**
 * Documento JSON de la solicitud tal como llegó.
 *
 * Guarda todo menos el correo, que se cifra en su columna (o su campo, en el
 * modo archivo): el documento conservado no duplica el dato protegido en
 * claro. El script del modo demo lo usa para sembrar filas idénticas a las
 * que produce la web.
 */
export const documentoRecibido = (dto: CrearSolicitudDto): Record<string, unknown> => {
    const { correoContacto: _correo, ...solicitud } = dto;
    void _correo;
    return {
        version: VERSION_DOCUMENTO,
        notaCorreo: 'El correo de contacto se guarda cifrado en su propia columna.',
        ...solicitud,
    };
};

@injectable()
export class CotizacionService {
    constructor(
        private readonly repo: CotizacionRepository,
        private readonly cipher: DbFieldCipher,
        private readonly auditoria: AuditoriaService,
        private readonly logger: LoggerService,
    ) {}

    /**
     * Registra una solicitud y responde con su estimación.
     *
     * La estimación se calcula aquí aunque el formulario la haya mostrado en
     * vivo: el backend es la fuente de verdad, y lo que queda guardado es
     * exactamente lo que el cliente vio.
     */
    async crear(dto: CrearSolicitudDto, ip: string | null): Promise<SolicitudCreada> {
        const estimacion = estimarNodos(dto);
        const fila = await this.repo.create({
            tipoRecinto: dto.tipoRecinto,
            organizacion: dto.organizacion,
            nombreContacto: dto.nombreContacto,
            correoContacto: this.cipher.encrypt(dto.correoContacto),
            telefonoContacto: dto.telefonoContacto || null,
            areaM2: dto.areaM2,
            aforoMinimo: dto.aforoMinimo,
            aforoMaximo: dto.aforoMaximo,
            eventosAnuales: dto.eventosAnuales,
            datos: documentoRecibido(dto),
            estimacion: estimacion as unknown as Record<string, unknown>,
            ipOrigen: ip,
        });

        this.logger.info(`Solicitud de cotización recibida ${fila.idSolicitud}`);
        return { idSolicitud: fila.idSolicitud, estimacion };
    }

    /** Solicitudes para el panel, de la más reciente hacia atrás. */
    async listar(estado?: EstadoSolicitud): Promise<SolicitudResumen[]> {
        const filas = await this.repo.findAll(estado);
        return filas.map((fila) => this.aResumen(fila));
    }

    /** Abre una solicitud con el contacto descifrado. */
    async obtener(idSolicitud: string): Promise<SolicitudDetalle> {
        const fila = await this.exigir(idSolicitud);
        return {
            ...this.aResumen(fila),
            correoContacto: this.descifrarCorreo(fila.correoContacto),
            telefonoContacto: fila.telefonoContacto,
            datos: fila.datos,
            estimacion: fila.estimacion as unknown as EstimacionCotizacion,
            notasComerciales: fila.notasComerciales,
            ipOrigen: fila.ipOrigen,
        };
    }

    /**
     * Mueve la solicitud por su ciclo comercial y registra el cambio.
     *
     * La auditoría queda sin datos personales: solo el identificador y el
     * estado, igual que el resto del registro.
     */
    async cambiarEstado(
        idSolicitud: string,
        estado: EstadoSolicitud,
        notas: string | undefined,
        idAdmin: string,
        ip: string | null,
    ): Promise<SolicitudDetalle> {
        await this.exigir(idSolicitud);
        await this.repo.actualizar(idSolicitud, {
            estado,
            ...(notas !== undefined ? { notasComerciales: notas || null } : {}),
        });
        await this.auditoria.registrar({
            tipo: 'cotizacion_actualizada',
            idAdmin,
            detalle: `cotizacion ${idSolicitud.slice(0, 8)} → ${estado}`,
            ip,
        });
        return this.obtener(idSolicitud);
    }

    /** Elimina una solicitud, dejando constancia en la auditoría. */
    async eliminar(idSolicitud: string, idAdmin: string, ip: string | null): Promise<void> {
        const elimina = await this.repo.deleteById(idSolicitud);
        if (!elimina) throw new NotFoundError('La solicitud no existe');
        await this.auditoria.registrar({
            tipo: 'cotizacion_eliminada',
            idAdmin,
            detalle: `cotizacion ${idSolicitud.slice(0, 8)} eliminada`,
            ip,
        });
    }

    /** Arma el documento .json que el panel descarga de una solicitud. */
    async documento(idSolicitud: string): Promise<DocumentoSolicitud> {
        const fila = await this.exigir(idSolicitud);
        return {
            idSolicitud: fila.idSolicitud,
            version: VERSION_DOCUMENTO,
            recibida: fila.fechaCreacion.toISOString(),
            estado: fila.estado,
            solicitud: fila.datos,
            estimacion: fila.estimacion as unknown as EstimacionCotizacion,
            notasComerciales: fila.notasComerciales,
        };
    }

    /** Lanza 404 si la solicitud no existe; devuelve la fila si sí. */
    private async exigir(idSolicitud: string): Promise<SolicitudCotizacion> {
        const fila = await this.repo.findById(idSolicitud);
        if (!fila) throw new NotFoundError('La solicitud no existe');
        return fila;
    }

    /**
     * Descifra un correo guardado. Si la columna viene en claro (una fila
     * antigua anterior al cifrado) lo devuelve tal cual, para que el panel
     * no se rompa mientras la base transita.
     */
    private descifrarCorreo(guardado: string): string {
        try {
            return this.cipher.decrypt(guardado);
        } catch {
            return guardado;
        }
    }

    /** Resumen de una fila, sin tocar el correo cifrado. */
    private aResumen(fila: SolicitudCotizacion): SolicitudResumen {
        const estimacion = fila.estimacion as unknown as EstimacionCotizacion;
        return {
            idSolicitud: fila.idSolicitud,
            tipoRecinto: fila.tipoRecinto,
            organizacion: fila.organizacion,
            nombreContacto: fila.nombreContacto,
            areaM2: fila.areaM2,
            aforoMinimo: fila.aforoMinimo,
            aforoMaximo: fila.aforoMaximo,
            eventosAnuales: fila.eventosAnuales,
            nodos: estimacion?.nodos ?? 0,
            estado: fila.estado,
            fechaCreacion: fila.fechaCreacion.toISOString(),
        };
    }
}
