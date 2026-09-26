/**
 * @file mac.ts
 * @description Primitivas sobre direcciones MAC (EUI-48), compartidas por la
 * ingesta, la anonimización y el procesamiento.
 *
 * Viven en un solo sitio porque la forma canónica de una MAC decide su hash:
 * si dos módulos normalizaran distinto, el mismo dispositivo tendría dos
 * `mac_hash` y se contaría dos veces.
 */

/** Dígitos hexadecimales de una EUI-48. */
const DIGITOS_MAC = 12;

/**
 * Forma canónica de una MAC: doce dígitos hexadecimales en minúscula, sin
 * separadores. Acepta `AA:BB:..`, `aa-bb-..` y `aabb.ccdd.eeff`.
 */
export const normalizarMac = (mac: string): string => mac.toLowerCase().replace(/[^0-9a-f]/g, '');

/** Primer octeto de una MAC ya normalizada. */
const primerOcteto = (normalizada: string): number => parseInt(normalizada.slice(0, 2), 16);

/** `true` si la MAC normalizada tiene exactamente seis octetos. */
export const esMacBienFormada = (normalizada: string): boolean =>
    normalizada.length === DIGITOS_MAC && /^[0-9a-f]+$/.test(normalizada);

/**
 * `true` si es una dirección de grupo (multidifusión o difusión): bit I/G del
 * primer octeto a 1. No identifica a un dispositivo, sino a un conjunto de
 * receptores, así que no puede contarse como ocupante.
 */
export const esMacDeGrupo = (normalizada: string): boolean => (primerOcteto(normalizada) & 0b01) !== 0;

/**
 * `true` si la MAC es administrada localmente: bit U/L del primer octeto a 1
 * (IEEE 802, sección 6.3 del documento). Es el caso de las direcciones
 * aleatorizadas que los teléfonos usan para no ser rastreados.
 */
export const esMacAleatoria = (mac: string): boolean => {
    const normalizada = normalizarMac(mac);
    return esMacBienFormada(normalizada) && (primerOcteto(normalizada) & 0b10) !== 0;
};
