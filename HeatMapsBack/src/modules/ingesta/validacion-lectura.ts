/**
 * @file validacion-lectura.ts
 * @description Etapa «Valida estructura» del diagrama de secuencia (RF-12, RNF-11).
 *
 * Lo que llega de Kafka ya viene descifrado, pero su contenido no está
 * garantizado: un nodo con otra versión del productor, un mensaje truncado o
 * uno fabricado por quien tenga acceso al tema llegarían igual. Aquí se
 * comprueba la forma de cada lectura antes de que ningún dato toque la base.
 *
 * Dos niveles de rechazo:
 * - Si falla el sobre (nodo, marca de tiempo, lista de dispositivos), se
 *   descarta la lectura entera: sin nodo o sin hora no hay dónde ni cuándo
 *   situar nada.
 * - Si falla un dispositivo suelto, se descarta solo ese: el resto de la
 *   lectura sigue siendo válido y útil.
 *
 * Además minimiza (RNF-01): de cada dispositivo solo pasan MAC, RSSI, canal y
 * tipo de trama. El resto de campos que envía el productor —SSID buscado,
 * paquetes, marcas de tiempo de Kismet— se quedan aquí y no se almacenan.
 */

import { z } from 'zod';
import type { DispositivoDetectado, LecturaSensor } from '../../types/sensor.types';

/** Rango de RSSI físicamente posible en Wi-Fi, en dBm. */
const RSSI_MINIMO_DBM = -120;
const RSSI_MAXIMO_DBM = 0;

/**
 * Tope de dispositivos por lectura. Un nodo en una plaza concurrida ve unos
 * cientos; muchos miles solo pueden ser un error o un abuso, y procesarlos
 * bloquearía la ingesta del resto de nodos.
 */
const MAXIMO_DISPOSITIVOS = 5000;

/** Canal válido: 1–196 cubre 2,4 GHz y 5 GHz. Fuera de ahí se guarda como desconocido. */
const CANAL_MAXIMO = 196;
const CANAL_DESCONOCIDO = 0;

/** Tipo de trama cuando el productor no lo informa. */
const TRAMA_DESCONOCIDA = 'desconocido';

/** Longitud de la columna `captura.tipo_trama`. */
const LARGO_TIPO_TRAMA = 20;

const sobreSchema = z.object({
    sensor_id: z.string().trim().min(1).max(50),
    timestamp: z.number().finite().positive(),
    devices: z.array(z.unknown()).max(MAXIMO_DISPOSITIVOS),
});

const dispositivoSchema = z.object({
    mac: z.string().min(1).max(64),
    rssi: z.number().finite().min(RSSI_MINIMO_DBM).max(RSSI_MAXIMO_DBM),
    channel: z.union([z.number(), z.string()]).nullish(),
    /**
     * El productor informa el tipo de trama en `status` (PROBING cuando el
     * teléfono busca redes, ASSOCIATED cuando está conectado). `type` se acepta
     * por compatibilidad con versiones anteriores.
     */
    status: z.string().nullish(),
    type: z.string().nullish(),
});

/** Resultado de validar una lectura. */
export type ResultadoValidacion =
    | { valida: true; lectura: LecturaSensor; descartados: number }
    | { valida: false; motivo: string };

/** Canal como entero dentro de rango, o desconocido. */
const leerCanal = (canal: number | string | null | undefined): number => {
    const numero = Number(canal);
    return Number.isInteger(numero) && numero > 0 && numero <= CANAL_MAXIMO ? numero : CANAL_DESCONOCIDO;
};

/** Tipo de trama en minúscula, recortado a su columna. */
const leerTipoTrama = (status: string | null | undefined, type: string | null | undefined): string => {
    const tipo = (status ?? type ?? '').trim().toLowerCase();
    return (tipo || TRAMA_DESCONOCIDA).slice(0, LARGO_TIPO_TRAMA);
};

/** Primer problema de validación, legible en el registro. */
const describir = (error: z.ZodError): string => {
    const [problema] = error.issues;
    const campo = problema.path.join('.') || 'lectura';
    return `${campo}: ${problema.message}`;
};

/**
 * Valida una lectura descifrada y la convierte al formato interno.
 *
 * @param dato - Contenido descifrado del mensaje, sin suponer su forma.
 */
export const validarLectura = (dato: unknown): ResultadoValidacion => {
    const sobre = sobreSchema.safeParse(dato);
    if (!sobre.success) return { valida: false, motivo: describir(sobre.error) };

    const dispositivos: DispositivoDetectado[] = [];
    let descartados = 0;
    for (const bruto of sobre.data.devices) {
        const dispositivo = dispositivoSchema.safeParse(bruto);
        if (!dispositivo.success) {
            descartados++;
            continue;
        }
        const { mac, rssi, channel, status, type } = dispositivo.data;
        dispositivos.push({
            mac,
            rssi: Math.trunc(rssi),
            canal: leerCanal(channel),
            tipoTrama: leerTipoTrama(status, type),
        });
    }

    return {
        valida: true,
        lectura: { sensorId: sobre.data.sensor_id, timestamp: sobre.data.timestamp, dispositivos },
        descartados,
    };
};
