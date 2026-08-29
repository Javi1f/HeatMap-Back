import { ValueTransformer } from 'typeorm';

/**
 * Transformer para columnas DECIMAL de MySQL.
 *
 * El driver `mysql2` devuelve los DECIMAL como `string` para no perder
 * precisión. En este dominio los valores (RSSI medio, distancia estimada) son
 * magnitudes físicas de pocos dígitos, así que convertirlos a `number` es
 * seguro y evita que un `"−67.50"` se cuele hasta el JSON de la API.
 */
export const decimalTransformer: ValueTransformer = {
    to: (value?: number | null) => value ?? null,
    from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};
