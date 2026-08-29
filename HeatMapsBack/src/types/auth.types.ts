/**
 * Tipos de dominio para autenticación.
 *
 * Notas:
 *  - Las **DTOs de request** (`LoginDto`, `RegisterDto`, etc.) viven en
 *    `src/modules/auth/dto/` derivadas de su esquema Zod. NO se ponen aquí
 *    para evitar duplicación de definición/validación.
 *  - Esta interfaz `JwtPayload` la consumen tanto el servicio que firma
 *    como el middleware que verifica.
 */

/**
 * Payload firmado dentro del JWT del administrador.
 */
export interface JwtPayload {
    /** Identificador del administrador. */
    id: number;

    /** Nombre de usuario ya descifrado. */
    username: string;

    /** Correo ya descifrado. */
    email: string;
}
