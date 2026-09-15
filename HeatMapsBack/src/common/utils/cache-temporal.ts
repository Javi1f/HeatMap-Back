/**
 * Caché en memoria con caducidad fija, para respuestas que muchos clientes
 * piden a la vez y que no cambian dentro de unos segundos.
 *
 * Guarda la **promesa**, no el valor: si llegan diez peticiones mientras la
 * primera consulta aún está en curso, las diez esperan esa misma consulta en
 * lugar de lanzar diez. Si la consulta falla, se descarta enseguida para que la
 * siguiente petición lo reintente.
 */
export interface CacheTemporal<T> {
    /** Devuelve el valor de `clave`, calculándolo con `calcular` si no está o caducó. */
    obtener(clave: string, calcular: () => Promise<T>): Promise<T>;
}

/** Tope de entradas, para que claves muy variadas no hagan crecer la memoria. */
const TOPE_ENTRADAS = 500;

/**
 * Crea una caché temporal.
 *
 * @param duracionMs - Tiempo de vida de cada entrada.
 * @param ahora      - Reloj, inyectable para las pruebas.
 */
export const crearCacheTemporal = <T>(duracionMs: number, ahora: () => number = Date.now): CacheTemporal<T> => {
    const entradas = new Map<string, { expira: number; valor: Promise<T> }>();

    return {
        obtener(clave, calcular) {
            const vigente = entradas.get(clave);
            if (vigente && vigente.expira > ahora()) return vigente.valor;

            if (entradas.size >= TOPE_ENTRADAS) entradas.clear();
            const valor = calcular();
            entradas.set(clave, { expira: ahora() + duracionMs, valor });
            valor.catch(() => entradas.delete(clave));
            return valor;
        },
    };
};
