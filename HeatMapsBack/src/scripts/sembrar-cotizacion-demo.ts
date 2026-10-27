/**
 * Siembra 10 solicitudes de cotización de ejemplo en el modo archivo.
 *
 * Prepara la demostración del módulo comercial (jurado, presentaciones): el
 * panel abre con una fila creíble —fechas repartidas por semanas, los cinco
 * estados del ciclo, notas del equipo comercial— sin esperar a que alguien
 * llene el formulario.
 *
 * Uso:
 *   `npm run cotizacion:demo`
 *
 * Sobrescribe el archivo completo cada vez que se corre, así que también
 * sirve para reiniciar la demo a un estado conocido.
 *
 * Los contactos son inventados. El correo se cifra igual que en producción
 * (`DbFieldCipher`): ni siquiera en la demo duerme en claro.
 */
import '../loadEnv';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { DbFieldCipher } from '../crypto/db-field.crypto';
import { documentoRecibido } from '../modules/cotizacion/cotizacion.service';
import { estimarNodos } from '../modules/cotizacion/estimacion';
import type { CrearSolicitudDto } from '../modules/cotizacion/cotizacion.dto';
import type { EstadoSolicitud } from '../persistencia/entidades/SolicitudCotizacion.entity';
import { nuevoUuid } from '../persistencia/entidades/uuid';
import type { FilaSolicitud } from '../persistencia/repositorios/cotizacion.repository-archivo';
import {
    rutaSolicitudesArchivo,
    escribirSolicitudesArchivo,
} from '../persistencia/repositorios/cotizacion.repository-archivo';

/** Una solicitud de ejemplo: su formulario más cuándo llegó y cómo va. */
interface SolicitudDemo {
    /** Lo que el visitante mandó desde el formulario. */
    dto: CrearSolicitudDto;
    /** Estado del ciclo comercial en que se muestra en el panel. */
    estado: EstadoSolicitud;
    /** Cuántos días atrás llegó, contados desde ahora. */
    diasAtras: number;
    /** Hora local en que llegó, para que las fechas parezcan de oficina. */
    hora: string;
    /** IP desde la que llegó, coherente con un visitante colombiano. */
    ip: string;
    notas?: string;
}

/**
 * Las diez solicitudes de la demo.
 *
 * El reparto no es al azar: estados viejos llevan fechas viejas, como en
 * una fila comercial real. Las organizaciones son ficticias pero verosímiles.
 */
const DEMO: SolicitudDemo[] = [
    {
        dto: {
            tipoRecinto: 'centro-convenciones',
            organizacion: 'Centro de Convenciones Las Américas',
            nombreContacto: 'Carolina Restrepo',
            correoContacto: 'eventos@convencioneslasamericas.co',
            telefonoContacto: '+57 300 555 0134',
            areaM2: 8200,
            aforoMinimo: 500,
            aforoMaximo: 4500,
            eventosAnuales: 42,
            requisitos: {
                camaras: false,
                analisisRed: true,
                seguridadPrivada: false,
                ventilacionRemota: true,
            },
            aceptaDatos: true,
        },
        estado: 'contactada',
        diasAtras: 6,
        hora: '09:40',
        ip: '190.85.42.17',
        notas: 'Llamada del viernes: piden la propuesta por fases. Enviar antes del 15 de noviembre.',
    },
    {
        dto: {
            tipoRecinto: 'universidad',
            organizacion: 'Universidad Sabana Norte',
            nombreContacto: 'Andrés Molina',
            correoContacto: 'campus@usn.edu.co',
            telefonoContacto: '+57 310 555 0182',
            areaM2: 14500,
            aforoMinimo: 300,
            aforoMaximo: 6000,
            eventosAnuales: 90,
            requisitos: {
                camaras: false,
                analisisRed: true,
                seguridadPrivada: false,
                ventilacionRemota: false,
                notas: 'Las aulas más concurridas son el bloque C y la biblioteca.',
            },
            aceptaDatos: true,
        },
        estado: 'en-revision',
        diasAtras: 4,
        hora: '15:12',
        ip: '181.54.120.88',
        notas: 'Piden integrar el conteo con el control de acceso del campus: revisar factibilidad.',
    },
    {
        dto: {
            tipoRecinto: 'auditorio',
            organizacion: 'Teatro Municipal de Chapinero',
            nombreContacto: 'Luisa Fernández',
            correoContacto: 'programacion@teatrochapinero.co',
            telefonoContacto: '+57 601 555 0420',
            areaM2: 1350,
            aforoMinimo: 400,
            aforoMaximo: 900,
            eventosAnuales: 110,
            requisitos: {
                camaras: false,
                analisisRed: false,
                seguridadPrivada: true,
                ventilacionRemota: true,
            },
            aceptaDatos: true,
        },
        estado: 'cerrada',
        diasAtras: 21,
        hora: '11:05',
        ip: '190.24.61.203',
        notas: 'Cotización aceptada. Piloto de tres nodos para diciembre, sujeto a la agenda cultural.',
    },
    {
        dto: {
            tipoRecinto: 'plaza-publica',
            organizacion: 'Plaza de Mercados La Central',
            nombreContacto: 'Jorge Salamanca',
            correoContacto: 'gerencia@plazalacentral.co',
            telefonoContacto: '+57 320 555 0177',
            areaM2: 3200,
            aforoMinimo: 800,
            aforoMaximo: 2500,
            eventosAnuales: 48,
            requisitos: {
                camaras: false,
                analisisRed: false,
                seguridadPrivada: false,
                ventilacionRemota: false,
            },
            aceptaDatos: true,
        },
        estado: 'nueva',
        diasAtras: 1,
        hora: '08:22',
        ip: '191.95.18.44',
    },
    {
        dto: {
            tipoRecinto: 'estadio',
            organizacion: 'Estadio Metropolitano del Valle',
            nombreContacto: 'Fernando Cárdenas',
            correoContacto: 'operaciones@estadiovalle.co',
            telefonoContacto: '+57 305 555 0391',
            areaM2: 28000,
            aforoMinimo: 12000,
            aforoMaximo: 38000,
            eventosAnuales: 26,
            requisitos: {
                camaras: false,
                analisisRed: false,
                seguridadPrivada: false,
                ventilacionRemota: true,
            },
            aceptaDatos: true,
        },
        estado: 'descartada',
        diasAtras: 15,
        hora: '16:48',
        ip: '201.244.73.9',
        notas: 'Presupuesto fuera de alcance para 2026. Reintentar cuando cierren el plan de modernización.',
    },
    {
        dto: {
            tipoRecinto: 'centro-comercial',
            organizacion: 'Centro Comercial Andino Sur',
            nombreContacto: 'Paola Quintero',
            correoContacto: 'operaciones@andinosur.com',
            telefonoContacto: '+57 315 555 0246',
            areaM2: 19000,
            aforoMinimo: 4000,
            aforoMaximo: 12000,
            eventosAnuales: 365,
            requisitos: {
                camaras: true,
                analisisRed: true,
                seguridadPrivada: false,
                ventilacionRemota: false,
            },
            aceptaDatos: true,
        },
        estado: 'en-revision',
        diasAtras: 9,
        hora: '10:31',
        ip: '186.154.9.71',
        notas: 'Quieren alerta de aforo por zona. Pedir el mapa de zonas del centro comercial.',
    },
    {
        dto: {
            tipoRecinto: 'centro-convenciones',
            organizacion: 'Corporación Ferias del Trópico',
            nombreContacto: 'Hernán Botero',
            correoContacto: 'ferias@corpotropico.co',
            telefonoContacto: '+57 301 555 0268',
            areaM2: 5600,
            aforoMinimo: 1000,
            aforoMaximo: 6000,
            eventosAnuales: 18,
            requisitos: {
                camaras: false,
                analisisRed: true,
                seguridadPrivada: true,
                ventilacionRemota: false,
                notas: 'Preguntaron por el alcance en los pabellones techados versus la zona abierta.',
            },
            aceptaDatos: true,
        },
        estado: 'nueva',
        diasAtras: 2,
        hora: '14:07',
        ip: '190.159.30.126',
    },
    {
        dto: {
            tipoRecinto: 'universidad',
            organizacion: 'Universidad Piloto de Occidente',
            nombreContacto: 'Diana Caicedo',
            correoContacto: 'admisiones@upo.edu.co',
            telefonoContacto: '+57 313 555 0513',
            areaM2: 9800,
            aforoMinimo: 500,
            aforoMaximo: 3200,
            eventosAnuales: 75,
            requisitos: {
                camaras: true,
                analisisRed: false,
                seguridadPrivada: false,
                ventilacionRemota: false,
            },
            aceptaDatos: true,
        },
        estado: 'nueva',
        diasAtras: 0,
        hora: '09:16',
        ip: '181.49.72.230',
    },
    {
        dto: {
            tipoRecinto: 'auditorio',
            organizacion: 'Auditorio Mayor del Caribe',
            nombreContacto: 'Marta Arregocés',
            correoContacto: 'cultura@auditoriodelcaribe.co',
            telefonoContacto: '+57 300 555 0887',
            areaM2: 2400,
            aforoMinimo: 900,
            aforoMaximo: 1800,
            eventosAnuales: 60,
            requisitos: {
                camaras: false,
                analisisRed: false,
                seguridadPrivada: false,
                ventilacionRemota: true,
            },
            aceptaDatos: true,
        },
        estado: 'contactada',
        diasAtras: 11,
        hora: '17:25',
        ip: '190.13.98.55',
        notas: 'Interesados en el conteo por zonas para las graduaciones. Enviar la referencia del piloto de la plazoleta.',
    },
    {
        dto: {
            tipoRecinto: 'otro',
            organizacion: 'Parque Ferial del Norte',
            nombreContacto: 'Óscar Villalba',
            correoContacto: 'ferial@parquenorte.co',
            telefonoContacto: '+57 317 555 0299',
            areaM2: 16000,
            aforoMinimo: 2000,
            aforoMaximo: 9000,
            eventosAnuales: 34,
            requisitos: {
                camaras: true,
                analisisRed: true,
                seguridadPrivada: false,
                ventilacionRemota: false,
                notas: 'Recinto mixto, carpas y zona abierta: preguntan si se puede cotizar por carpa.',
            },
            aceptaDatos: true,
        },
        estado: 'en-revision',
        diasAtras: 7,
        hora: '13:53',
        ip: '190.67.201.14',
    },
];

/** La fecha de hace `diasAtras` días, a la hora local indicada. */
const fechaDe = (diasAtras: number, hora: string): Date => {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - diasAtras);
    const [horas, minutos] = hora.split(':').map(Number);
    fecha.setHours(horas, minutos, 0, 0);
    return fecha;
};

const cifrador = container.resolve(DbFieldCipher);

/**
 * Las filas tal como las dejaría el módulo por la web: el documento
 * `datos` sale de la misma función que usa el servicio, y la estimación
 * se congela de la misma manera.
 */
const solicitudes: FilaSolicitud[] = DEMO.map((demo) => {
    const { dto, estado, notas } = demo;
    const fecha = fechaDe(demo.diasAtras, demo.hora);
    return {
        idSolicitud: nuevoUuid(),
        tipoRecinto: dto.tipoRecinto,
        organizacion: dto.organizacion,
        nombreContacto: dto.nombreContacto,
        correoContacto: cifrador.encrypt(dto.correoContacto),
        telefonoContacto: dto.telefonoContacto ?? null,
        areaM2: dto.areaM2,
        aforoMinimo: dto.aforoMinimo,
        aforoMaximo: dto.aforoMaximo,
        eventosAnuales: dto.eventosAnuales,
        datos: documentoRecibido(dto),
        estimacion: estimarNodos(dto) as unknown as Record<string, unknown>,
        estado,
        notasComerciales: notas ?? null,
        ipOrigen: demo.ip,
        fechaCreacion: fecha,
        fechaActualizacion: fecha,
    };
});

escribirSolicitudesArchivo(solicitudes, rutaSolicitudesArchivo());

process.stdout.write(
    `Sembradas ${solicitudes.length} solicitudes de demo en ${rutaSolicitudesArchivo()}\n`,
);
