/**
 * Formato del archivo de respaldo, compartido por `respaldo-bd.ts` y
 * `restaurar-bd.ts`.
 *
 * Es SQL con **una sentencia por línea**. Así la restauración puede leer el
 * archivo línea a línea sin cargarlo entero en memoria —la tabla de capturas
 * pasa del millón de filas— y sin un analizador de SQL: el escapado de MySQL
 * convierte los saltos de línea de los valores en `\n`, y las sentencias
 * `CREATE TABLE`, que sí traen saltos de línea, se compactan en una.
 */

/** Prefijo de las líneas de manifiesto, que declaran cuántas filas se guardaron por tabla. */
export const PREFIJO_MANIFIESTO = '-- filas ';

/** Filas por sentencia `INSERT`. */
export const FILAS_POR_INSERT = 500;

/** Convierte el `CREATE TABLE` de `SHOW CREATE TABLE` en una sentencia idempotente de una línea. */
export const crearTablaEnUnaLinea = (createTable: string): string =>
    `${createTable.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ').replace(/\s*\n\s*/g, ' ')};`;

/** Envuelve un identificador SQL entre acentos graves. */
export const identificador = (nombre: string): string => `\`${nombre.replace(/`/g, '``')}\``;

/**
 * Construye un `INSERT` de varias filas.
 *
 * @param escapar - Función de escapado de valores del driver de MySQL.
 */
export const sentenciaInsert = (
    tabla: string,
    columnas: readonly string[],
    filas: readonly Record<string, unknown>[],
    escapar: (valor: unknown) => string,
): string => {
    const cabecera = `INSERT INTO ${identificador(tabla)} (${columnas.map(identificador).join(', ')}) VALUES `;
    const valores = filas.map((fila) => `(${columnas.map((columna) => escapar(fila[columna])).join(', ')})`);
    return `${cabecera}${valores.join(', ')};`;
};

/** Línea de manifiesto con el número de filas guardadas de una tabla. */
export const lineaManifiesto = (tabla: string, filas: number): string => `${PREFIJO_MANIFIESTO}${tabla} ${filas}`;

/**
 * Lee una línea de manifiesto.
 *
 * @returns La tabla y su número de filas, o `null` si la línea no es de manifiesto.
 */
export const leerManifiesto = (linea: string): { tabla: string; filas: number } | null => {
    if (!linea.startsWith(PREFIJO_MANIFIESTO)) return null;
    const [tabla, filas] = linea.slice(PREFIJO_MANIFIESTO.length).trim().split(/\s+/);
    const numero = Number(filas);
    return tabla && Number.isInteger(numero) ? { tabla, filas: numero } : null;
};

/** Indica si una línea es una sentencia ejecutable (no vacía ni comentario). */
export const esSentencia = (linea: string): boolean => {
    const limpia = linea.trim();
    return limpia.length > 0 && !limpia.startsWith('--');
};
