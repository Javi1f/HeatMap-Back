import 'express';
import { JwtPayload } from '../../types/auth.types';

/**
 * Extensión tipada del objeto `Request` de Express.
 *
 * Reemplaza el anti-patrón `(req as any).admin` por acceso tipado:
 *
 *     req.admin?.id    // ✓ tipado
 *     req.requestId    // ✓ tipado
 *
 * El módulo se aumenta vía declaration merging — basta con que TypeScript
 * lo incluya en la compilación (está dentro de `src/`).
 */
declare module 'express-serve-static-core' {
    interface Request {
        /**
         * Payload del JWT del administrador autenticado. Solo presente cuando
         * la ruta pasó por `authMiddleware`.
         */
        admin?: JwtPayload;

        /**
         * Identificador único de la petición para correlacionar logs.
         * Inyectado por `requestIdMiddleware` al inicio del pipeline.
         */
        requestId?: string;
    }
}
