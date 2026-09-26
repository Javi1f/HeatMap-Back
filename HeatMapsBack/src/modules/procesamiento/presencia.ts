/**
 * Criterios que deciden qué detecciones describen a alguien presente en una
 * zona y cuáles son ruido: infraestructura de red o señales que llegan de otro
 * piso, de un pasillo o de la calle.
 *
 * Son funciones puras, sin base de datos ni reloj, para que el criterio sea uno
 * solo —el mapa, la ocupación consolidada y el panel cuentan con él— y se pueda
 * fijar por completo en pruebas.
 */

import type { MotivoInfraestructura } from '../../persistencia/entidades/DispositivoInfraestructura.entity';
import type { SenalPorNodo } from '../../persistencia/repositorios/captura.repository';
import { esMacBienFormada, normalizarMac } from '../../common/utils/mac';

/*
 * Los dos tipos que comparten el criterio y la persistencia viven en la capa de
 * persistencia, que es quien los guarda y los devuelve; aquí solo se
 * reexportan. Así los repositorios no dependen de la capa de procesamiento.
 */
export type { MotivoInfraestructura, SenalPorNodo };

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

/** Media aritmética de una lista no vacía. */
const media = (valores: readonly number[]): number => valores.reduce((suma, valor) => suma + valor, 0) / valores.length;

/** Agrupa las detecciones por los dígitos que comparten los BSSID de un aparato. */
const agruparPorPrefijo = (detecciones: readonly DeteccionCruda[]): DeteccionCruda[][] => {
    const grupos = new Map<string, DeteccionCruda[]>();
    for (const deteccion of detecciones) {
        const prefijo = normalizarMac(deteccion.mac).slice(0, DIGITOS_PREFIJO_PUNTO_ACCESO);
        grupos.set(prefijo, [...(grupos.get(prefijo) ?? []), deteccion]);
    }
    return [...grupos.values()];
};

/** Indica si otra detección del grupo llega con la misma señal. */
const tieneHermano = (deteccion: DeteccionCruda, grupo: readonly DeteccionCruda[]): boolean =>
    grupo.some(
        (otra) => otra !== deteccion && Math.abs(otra.rssi - deteccion.rssi) <= DISPERSION_MAXIMA_PUNTO_ACCESO_DB,
    );

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
    const validas = detecciones.filter((deteccion) => esMacBienFormada(normalizarMac(deteccion.mac)));
    const motivos = new Map<string, MotivoInfraestructura>();

    for (const grupo of agruparPorPrefijo(validas)) {
        grupo
            .filter((deteccion) => tieneHermano(deteccion, grupo))
            .forEach((deteccion) => motivos.set(deteccion.mac, 'punto-de-acceso'));
    }

    validas
        .filter((deteccion) => !motivos.has(deteccion.mac) && deteccion.rssi >= RSSI_JUNTO_A_NODO_DBM)
        .forEach((deteccion) => motivos.set(deteccion.mac, 'junto-a-nodo'));

    return motivos;
};

/** Umbrales con los que se decide la presencia. */
export interface CriteriosPresencia {
    /** Señal mínima exigida en el nodo que peor oye al dispositivo, en dBm. */
    rssiMinimoDbm: number;

    /** Nodos que deben oír al dispositivo para contarlo presente. */
    nodosMinimos: number;

    /**
     * Señal mínima exigida en el nodo que **mejor** oye al dispositivo, en dBm:
     * quien está dentro tiene siempre algún nodo relativamente cerca.
     */
    rssiMejorMinimoDbm: number;

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

/** Señales de un mismo dispositivo en todos los nodos que lo oyeron. */
interface SenalesDeDispositivo {
    /** RSSI medio en cada nodo, en dBm. */
    rssi: number[];

    /** `true` si su MAC es administrada localmente. */
    esMacRandom: boolean;
}

/** Agrupa las señales por dispositivo. */
const agruparPorDispositivo = (senales: readonly SenalPorNodo[]): Map<string, SenalesDeDispositivo> => {
    const porDispositivo = new Map<string, SenalesDeDispositivo>();
    for (const senal of senales) {
        const previo = porDispositivo.get(senal.macHash) ?? { rssi: [], esMacRandom: false };
        porDispositivo.set(senal.macHash, {
            rssi: [...previo.rssi, senal.rssi],
            esMacRandom: previo.esMacRandom || senal.esMacRandom,
        });
    }
    return porDispositivo;
};

/** Veredicto sobre un dispositivo. */
type Veredicto = 'infraestructura' | 'fuera' | 'presente';

/**
 * Clasifica un dispositivo según los criterios de presencia.
 *
 * @param nodosActivos - Nodos que emitieron en la ventana.
 */
const clasificar = (
    macHash: string,
    { rssi }: SenalesDeDispositivo,
    nodosActivos: number,
    criterios: CriteriosPresencia,
): Veredicto => {
    if (criterios.excluidos.has(macHash)) return 'infraestructura';
    const loOyenBastantes = rssi.length >= Math.min(criterios.nodosMinimos, nodosActivos);
    const alguienLoOyeCerca = Math.max(...rssi) >= criterios.rssiMejorMinimoDbm;
    const nadieLoOyeAtenuado = Math.min(...rssi) >= criterios.rssiMinimoDbm;
    return loOyenBastantes && alguienLoOyeCerca && nadieLoOyeAtenuado ? 'presente' : 'fuera';
};

/**
 * Decide qué dispositivos están dentro de la zona.
 *
 * Un dispositivo cuenta si se cumplen las tres condiciones:
 *
 * 1. **Lo oyen varios nodos** (`nodosMinimos`). Lo que está tras la pared de
 *    una esquina lo oye el nodo de esa esquina y apenas los otros.
 * 2. **El nodo que mejor lo oye lo oye fuerte** (`rssiMejorMinimoDbm`). Ningún
 *    punto del espacio está lejos de todos los nodos —en la plazoleta, a más de
 *    unos 10,6 m del más cercano—, así que quien está dentro tiene siempre uno
 *    que lo oye bien. Lo que llega igual de débil a todos está lejos de todos:
 *    en la sala de al lado o en otro piso.
 * 3. **Ninguno lo oye atenuado** (`rssiMinimoDbm`). Lo del piso de abajo lo
 *    oyen todos, pero todos atenuados por el forjado.
 *
 * Se calibró con una verdad de referencia: tres dispositivos conocidos dentro
 * y todo lo demás fuera, en una ventana de 10 minutos. Los tres reales los
 * oyeron los tres nodos, cada uno con decenas de tramas, y el nodo que mejor
 * los oía estaba entre −56 y −46 dBm. Con las condiciones 1 y 3 solas se
 * colaban 121 dispositivos de fuera; con la 2, cuatro, dos de ellos
 * equipamiento pegado a un nodo que corresponde a la regla de infraestructura.
 *
 * **Cuántos nodos deben oírlo** lo decide `nodosMinimos`, y nunca se exigen más
 * de los que emitieron en la ventana: si un nodo se cae, exigirlo dejaría el
 * mapa vacío en lugar de degradarlo.
 *
 * Deben llegar sólo señales de una misma zona.
 */
export const evaluarPresencia = (
    senales: readonly SenalPorNodo[],
    criterios: CriteriosPresencia,
): EvaluacionPresencia => {
    const nodosActivos = new Set(senales.map((senal) => senal.idSensor)).size;
    const resultado: EvaluacionPresencia = {
        presentes: new Map(),
        descartadosInfraestructura: 0,
        descartadosFueraDeZona: 0,
    };

    for (const [macHash, dispositivo] of agruparPorDispositivo(senales)) {
        const veredicto = clasificar(macHash, dispositivo, nodosActivos, criterios);
        if (veredicto === 'infraestructura') resultado.descartadosInfraestructura++;
        else if (veredicto === 'fuera') resultado.descartadosFueraDeZona++;
        else resultado.presentes.set(macHash, { rssiMedio: media(dispositivo.rssi), esMacRandom: dispositivo.esMacRandom });
    }

    return resultado;
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
