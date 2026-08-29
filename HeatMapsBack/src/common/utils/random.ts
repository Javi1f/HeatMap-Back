import crypto from 'crypto';

/**
 * Genera un código numérico aleatorio criptográficamente seguro.
 *
 * Reemplaza el anti-patrón `Math.floor(Math.random() * ...)`, que no es seguro
 * para casos como códigos de verificación (Math.random no es CSPRNG).
 *
 * Usa `crypto.randomInt`, que reparte de forma uniforme sobre un generador
 * criptográficamente seguro. Un `Math.random()` escalado sesgaría el resultado
 * y sería predecible, inaceptable en un código de verificación.
 *
 * @param digits - Número de dígitos del código (default 5).
 * @returns String con el código rellenado con ceros a la izquierda si hace falta.
 *
 * @example
 *   generateNumericCode(5) // "08423"
 */
export const generateNumericCode = (digits = 5): string => {
    if (digits < 1 || digits > 12) {
        throw new RangeError('digits debe estar entre 1 y 12');
    }
    const max = 10 ** digits;
    const n = crypto.randomInt(0, max);
    return n.toString().padStart(digits, '0');
};
