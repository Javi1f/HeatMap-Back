/**
 * @file filtro-mac.ts
 * @description Etapa «Filtrado MAC» del diagrama de secuencia (RF-11).
 *
 * Va entre la validación y la anonimización: trabaja con la MAC en claro,
 * porque después del hash ya no se puede saber si una dirección era de grupo ni
 * juntar dos formas distintas de escribir la misma.
 *
 * Qué depura:
 * - **Mal formadas**: no tienen seis octetos. No identifican nada.
 * - **De grupo** (multidifusión o difusión): no son un dispositivo sino un
 *   conjunto de receptores.
 * - **Duplicadas** dentro de la misma lectura: la misma MAC escrita dos veces,
 *   con o sin separadores o mayúsculas. Se conserva la de señal más fuerte,
 *   que es la medida más fiable de las dos.
 *
 * Qué no descarta: las **aleatorizadas**. Son teléfonos reales que rotan su
 * dirección, y descartarlas dejaría fuera a la mayoría de los presentes. Se
 * marcan (`es_mac_random`) y el procesamiento las distingue de los dispositivos
 * estables (`ocupacion_agregada.dispositivos_estables`), como plantea la
 * sección 6.3 del documento.
 */

import { esMacBienFormada, esMacDeGrupo, normalizarMac } from '../../common/utils/mac';
import type { DispositivoDetectado } from '../../types/sensor.types';

/** Cuántos dispositivos se quitaron y por qué. */
export interface DescartesFiltro {
    malformadas: number;
    deGrupo: number;
    duplicadas: number;
}

/** Dispositivos que pasan el filtro, con la MAC ya en forma canónica. */
export interface ResultadoFiltro {
    dispositivos: DispositivoDetectado[];
    descartes: DescartesFiltro;
}

/**
 * Depura los dispositivos de una lectura.
 *
 * @param dispositivos - Dispositivos ya validados.
 */
export const filtrarMacs = (dispositivos: readonly DispositivoDetectado[]): ResultadoFiltro => {
    const porMac = new Map<string, DispositivoDetectado>();
    const descartes: DescartesFiltro = { malformadas: 0, deGrupo: 0, duplicadas: 0 };

    for (const dispositivo of dispositivos) {
        const mac = normalizarMac(dispositivo.mac);
        if (!esMacBienFormada(mac)) {
            descartes.malformadas++;
            continue;
        }
        if (esMacDeGrupo(mac)) {
            descartes.deGrupo++;
            continue;
        }

        const previo = porMac.get(mac);
        if (previo) descartes.duplicadas++;
        if (!previo || dispositivo.rssi > previo.rssi) porMac.set(mac, { ...dispositivo, mac });
    }

    return { dispositivos: [...porMac.values()], descartes };
};

/** Total de dispositivos descartados por el filtro. */
export const totalDescartes = ({ malformadas, deGrupo, duplicadas }: DescartesFiltro): number =>
    malformadas + deGrupo + duplicadas;
