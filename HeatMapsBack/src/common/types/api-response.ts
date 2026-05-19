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
    success: true;
    message?: string;
    data?: T;
}

/**
 * Respuesta de error de la API. Mapeada centralmente por el `errorHandler`
 * a partir de un {@link AppError}.
 */
export interface ApiErrorResponse {
    success: false;
    message: string;
    code: string;
    statusCode: number;
    details?: Record<string, unknown>;
}

/**
 * Unión discriminada de las dos formas posibles de respuesta.
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
