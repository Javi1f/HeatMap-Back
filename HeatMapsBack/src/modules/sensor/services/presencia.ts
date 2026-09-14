/**
 * Criterios que deciden qué detecciones describen a alguien presente en una
 * zona y cuáles son ruido: infraestructura de red o señales que llegan de otro
 * piso, de un pasillo o de la calle.
 *
 * Son funciones puras, sin base de datos ni reloj, para que el criterio sea uno
 * solo —el mapa, la ocupación consolidada y el panel cuentan con él— y se pueda
 * fijar por completo en pruebas.
 */

/** Por qué un dispositivo se trata como infraestructura y no como ocupante. */
export type MotivoInfraestructura = 'punto-de-acceso' | 'junto-a-nodo' | 'manual';

/** Dispositivo tal como llega en una lectura, antes de anonimizar su MAC. */
export interface DeteccionCruda {
    /** Dirección MAC en cualquier formato habitual. */
    mac: string;

    /** Potencia recibida por el nodo, en dBm. */
    rssi: number;
}

/**
 * Dígitos hexadecimales que comparten los BSSID de un mismo punto de acceso.
 *
 * Un punto de acceso corporativo emite una red por SSID y por banda, cada una
 * con su BSSID, y el fabricante los numera correlativos variando sólo el último
 * dígito: en la plazoleta, `a4:b2:39:9b:84:60`, `…:63`, `…:6c`, `…:6e` y `…:6f`
 * son UNBOSQUE, UEB_Tita y VIP de un único aparato. Once dígitos son 44 bits:
 * dos teléfonos o portátiles distintos no coinciden en tantos por azar, ni
 * siquiera siendo del mismo modelo.
 */
const DIGITOS_PREFIJO_PUNTO_ACCESO = 11;

/**
 * Diferencia máxima de señal entre BSSID hermanos, en dB.
 *
 * Salen de la misma antena, así que cada nodo los oye prácticamente igual. Se
 * exige además de compartir prefijo para que una coincidencia de prefijo entre
 * dos aparatos alejados no baste.
 */
const DISPERSION_MAXIMA_PUNTO_ACCESO_DB = 6;

/**
 * Señal a partir de la cual el emisor está pegado al nodo, en dBm.
 *
 * A −35 dBm un teléfono está a menos de un metro de la antena. Lo que se
 * queda ahí es equipamiento del propio despliegue: la Wi-Fi de la Raspberry,
 * medida a −21 dBm, o el hotspot que le da salida a internet, a −33 dBm.
 */
export const RSSI_JUNTO_A_NODO_DBM = -35;

/** Deja sólo los dígitos hexadecimales de una MAC, en minúscula. */
const normalizar = (mac: string): string => mac.toLowerCase().replace(/[^0-9a-f]/g, '');

/**
 * Detecta infraestructura en las detecciones de una lectura.
 *
 * Tiene que hacerse aquí, sobre la MAC en claro: una vez anonimizada, dos BSSID
 * correlativos dan hashes sin ninguna relación y el parentesco se pierde.
 *
 * @returns Motivo por MAC, sólo para las que resultan ser infraestructura.
 */
export const detectarInfraestructura = (
    detecciones: readonly DeteccionCruda[],
): Map<string, MotivoInfraestructura> => {
    const motivos = new Map<string, MotivoInfraestructura>();

    const validas = detecciones.filter((deteccion) => normalizar(deteccion.mac).length === 12);

    const porPrefijo = new Map<string, DeteccionCruda[]>();
    for (const deteccion of validas) {
        const prefijo = normalizar(deteccion.mac).slice(0, DIGITOS_PREFIJO_PUNTO_ACCESO);
        const grupo = porPrefijo.get(prefijo) ?? [];
        grupo.push(deteccion);
        porPrefijo.set(prefijo, grupo);
    }

    for (const grupo of porPrefijo.values()) {
        for (const deteccion of grupo) {
            const tieneHermano = grupo.some(
                (otra) =>
                    otra !== deteccion &&
                    Math.abs(otra.rssi - deteccion.rssi) <= DISPERSION_MAXIMA_PUNTO_ACCESO_DB,
            );
            if (tieneHermano) motivos.set(deteccion.mac, 'punto-de-acceso');
        }
    }

    for (const deteccion of validas) {
        if (!motivos.has(deteccion.mac) && deteccion.rssi >= RSSI_JUNTO_A_NODO_DBM) {
            motivos.set(deteccion.mac, 'junto-a-nodo');
        }
    }

    return motivos;
};

/** Señal media de un dispositivo en un nodo, dentro de una ventana. */
export interface SenalPorNodo {
    /** Identificador anónimo del dispositivo. */
    macHash: string;

    /** Nodo que lo oyó. */
    idSensor: string;

    /** RSSI medio en ese nodo, en dBm. */
    rssi: number;

    /** `true` si la MAC es administrada localmente. */
    esMacRandom: boolean;
}

/** Umbrales con los que se decide la presencia. */
export interface CriteriosPresencia {
    /** Señal mínima exigida en el nodo que peor oye al dispositivo, en dBm. */
    rssiMinimoDbm: number;

    /** Hashes de infraestructura vigente, que nunca cuentan como ocupantes. */
    excluidos: ReadonlySet<string>;
}

/** Dispositivo que se considera presente en la zona. */
export interface DispositivoPresente {
    /** Media de su señal entre todos los nodos, en dBm. */
    rssiMedio: number;

    /** `true` si su MAC es administrada localmente. */
    esMacRandom: boolean;
}

/** Resultado de evaluar una ventana de una zona. */
export interface EvaluacionPresencia {
    /** Dispositivos presentes, por hash. */
    presentes: Map<string, DispositivoPresente>;

    /** Descartados por ser infraestructura. */
    descartadosInfraestructura: number;

    /** Descartados porque su señal no es compatible con estar dentro. */
    descartadosFueraDeZona: number;
}

/**
 * Decide qué dispositivos están dentro de la zona.
 *
 * **El criterio es el nodo que peor lo oye.** Quien está en la plazoleta está
 * a línea de vista de todos los nodos, así que todos lo oyen y ninguno lo oye
 * débil. Lo que llega de fuera falla por algún lado: un dispositivo tras la
 * pared de una esquina lo oye fuerte el nodo de esa esquina y apenas los otros;
 * uno en el piso de abajo lo oyen todos, pero atenuado por el forjado. La señal
 * más fuerte no distingue ninguno de los dos casos; la más débil, sí.
 *
 * Se exige a los nodos **que emitieron en la ventana**, no a todos los de la
 * zona: si uno se cae, exigirlo dejaría el mapa vacío en lugar de degradarlo.
 *
 * Deben llegar sólo señales de una misma zona.
 */
export const evaluarPresencia = (
    senales: readonly SenalPorNodo[],
    criterios: CriteriosPresencia,
): EvaluacionPresencia => {
    const nodosActivos = new Set(senales.map((s) => s.idSensor));

    const porDispositivo = new Map<string, { rssi: number[]; esMacRandom: boolean }>();
    for (const senal of senales) {
        const dispositivo = porDispositivo.get(senal.macHash) ?? { rssi: [], esMacRandom: false };
        dispositivo.rssi.push(senal.rssi);
        dispositivo.esMacRandom ||= senal.esMacRandom;
        porDispositivo.set(senal.macHash, dispositivo);
    }

    const presentes = new Map<string, DispositivoPresente>();
    let descartadosInfraestructura = 0;
    let descartadosFueraDeZona = 0;

    for (const [macHash, { rssi, esMacRandom }] of porDispositivo) {
        if (criterios.excluidos.has(macHash)) {
            descartadosInfraestructura++;
            continue;
        }
        if (rssi.length < nodosActivos.size || Math.min(...rssi) < criterios.rssiMinimoDbm) {
            descartadosFueraDeZona++;
            continue;
        }
        const rssiMedio = rssi.reduce((suma, valor) => suma + valor, 0) / rssi.length;
        presentes.set(macHash, { rssiMedio, esMacRandom });
    }

    return { presentes, descartadosInfraestructura, descartadosFueraDeZona };
};

/** Cifras de los dispositivos presentes, listas para mostrar o consolidar. */
export interface ResumenPresencia {
    /** Dispositivos presentes. */
    dispositivos: number;

    /** Presentes con MAC de fabricante, que no rota dentro de la ventana. */
    estables: number;

    /** Presentes con MAC administrada localmente. */
    aleatorias: number;

    /** Media de la señal de los presentes, en dBm, o `null` si no hay ninguno. */
    rssiMedio: number | null;
}

/** Resume uno o varios conjuntos de dispositivos presentes. */
export const resumirPresentes = (...conjuntos: ReadonlyMap<string, DispositivoPresente>[]): ResumenPresencia => {
    const dispositivos = conjuntos.flatMap((conjunto) => [...conjunto.values()]);
    const aleatorias = dispositivos.filter((dispositivo) => dispositivo.esMacRandom).length;
    const suma = dispositivos.reduce((total, dispositivo) => total + dispositivo.rssiMedio, 0);

    return {
        dispositivos: dispositivos.length,
        estables: dispositivos.length - aleatorias,
        aleatorias,
        rssiMedio: dispositivos.length === 0 ? null : suma / dispositivos.length,
    };
};
