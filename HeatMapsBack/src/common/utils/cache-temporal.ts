/**
 * Caché en memoria con caducidad fija, para respuestas que muchos clientes
 * piden a la vez y que no cambian dentro de unos segundos.
 *
 * Guarda la **promesa**, no el valor: si llegan diez peticiones mientras la
 * primera consulta aún está en curso, las diez esperan esa misma consulta en
 * lugar de lanzar diez. Si la consulta falla, se descarta enseguida para que la
 * siguiente petición lo reintente.
 *
 * **La vida de una entrada empieza cuando el cálculo termina**, no cuando
 * empieza, y mientras está en curso no caduca. Contarla desde el principio
 * dejaba sin caché justo lo que más la necesita: el mapa de calor tarda unos
 * 3 s contra la base remota, así que con 1 s de vida llegaba ya caducado y
 * cada petición posterior lanzaba otro cálculo completo. En la prueba de carga
 * (CP-21) esos cálculos se acumulaban contra la base hasta dar errores con 200
 * usuarios.
 *
 * **Opcionalmente sirve lo caducado mientras recalcula** (`servirCaducadoMs`):
 * quien llega con la entrada recién caducada recibe el valor anterior al
 * instante y una sola petición lo recalcula en segundo plano. Sin esto, todas
 * las peticiones de los ~3 s que dura el recálculo del mapa esperaban, y ese
 * tiempo era el percentil 95 de la API. Pasado ese margen ya no se sirve lo
 * viejo —si la base se cae, no se muestra un mapa congelado como si fuera
 * actual—: se espera al cálculo, y si falla, falla.
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
 * @param duracionMs       - Tiempo de vida de cada entrada.
 * @param ahora            - Reloj, inyectable para las pruebas.
 * @param servirCaducadoMs - Cuánto tiempo después de caducar se sigue sirviendo
 *                           el valor anterior mientras se recalcula; 0, nunca.
 */
export const crearCacheTemporal = <T>(
    duracionMs: number,
    ahora: () => number = Date.now,
    servirCaducadoMs = 0,
): CacheTemporal<T> => {
    const entradas = new Map<string, { expira: number; valor: Promise<T>; refrescando: boolean }>();

    /** Lanza el cálculo y deja la entrada vigente cuando termina. Un fallo no sustituye a lo que hubiera. */
    const calcularEnEntrada = (clave: string, calcular: () => Promise<T>, enCurso: boolean): Promise<T> => {
        const valor = calcular();
        const entrada = { expira: Infinity, valor, refrescando: false };
        if (enCurso) {
            if (entradas.size >= TOPE_ENTRADAS) entradas.clear();
            entradas.set(clave, entrada);
        }
        valor.then(
            () => {
                entrada.expira = ahora() + duracionMs;
                entradas.set(clave, entrada);
            },
            () => {
                if (entradas.get(clave) === entrada) entradas.delete(clave);
            },
        );
        return valor;
    };

    return {
        obtener(clave, calcular) {
            const existente = entradas.get(clave);
            const momento = ahora();
            if (existente && existente.expira > momento) return existente.valor;

            if (existente && momento - existente.expira <= servirCaducadoMs) {
                if (!existente.refrescando) {
                    existente.refrescando = true;
                    calcularEnEntrada(clave, calcular, false).catch(() => {
                        existente.refrescando = false;
                    });
                }
                return existente.valor;
            }
            return calcularEnEntrada(clave, calcular, true);
        },
    };
};
