/**
 * Re-export histórico. La forma canónica de las respuestas de la API vive
 * ahora en `src/common/types/api-response.ts`. Este alias evita romper
 * imports antiguos hasta que se borren del todo.
 *
 * @deprecated importar desde `../common/types/api-response` en código nuevo.
 */
export type { ApiResponse, ApiSuccessResponse, ApiErrorResponse } from '../common/types/api-response';

/**
 * Forma de la respuesta del endpoint `GET /kafka/status`.
 */
export interface ConsumerStatusResponse {
    success: true;
    running: boolean;
    status: 'active' | 'stopped';
}
