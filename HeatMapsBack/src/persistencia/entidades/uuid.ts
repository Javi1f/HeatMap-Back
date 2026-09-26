import { randomUUID } from 'crypto';

/**
 * Identificador UUID v4 para una fila nueva.
 *
 * El modelo relacional (Anexo 13) usa UUID como clave de las entidades de
 * negocio. MySQL no tiene ese tipo, así que se guardan en `CHAR(36)` y los
 * asigna la aplicación al insertar (cada entidad lo hace en su
 * `@BeforeInsert`). El generador `uuid` de TypeORM no sirve aquí: declara la
 * columna como `VARCHAR(36)` y la entidad dejaría de coincidir con el DDL.
 */
export const nuevoUuid = (): string => randomUUID();

/** Opciones de columna de un UUID, igual en todas las tablas. */
export const COLUMNA_UUID = { type: 'char', length: 36 } as const;
