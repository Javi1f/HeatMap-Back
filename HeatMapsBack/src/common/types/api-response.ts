/**
 * Contratos de respuesta uniforme de la API HTTP.
 *
 * Todos los endpoints devuelven o {@link ApiSuccessResponse} o
 * {@link ApiErrorResponse}. El frontend puede discriminar por la propiedad
 * `success`.
 */

/**
 * Respuesta exitosa de la API.
 *
 * @typeParam T - Forma del payload.
 */
export interface ApiSuccessResponse<T = unknown> {
    /** Discriminante: siempre `true` en respuestas correctas. */
    success: true;

    /** Mensaje opcional para mostrar en la interfaz. */
    message?: string;

    /** Carga util, ausente en operaciones sin resultado. */
    data?: T;
}

/**
 * Respuesta de error de la API. Mapeada centralmente por el `errorHandler`
 * a partir de un {@link AppError}.
 */
export interface ApiErrorResponse {
    /** Discriminante: siempre `false` en respuestas de error. */
    success: false;

    /** Mensaje legible del error. */
    message: string;
    /** Codigo estable del error, espejo de `ErrorCode`. */
    code: string;

    /** Codigo HTTP de la respuesta. */
    statusCode: number;

    /** Detalle adicional. Se omite en producción. */
    details?: Record<string, unknown>;
}

/**
 * Unión discriminada de las dos formas posibles de respuesta.
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
