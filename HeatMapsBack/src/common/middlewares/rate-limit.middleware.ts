import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Familia de rate limiters centralizados.
 *
 * Centralizar aquí (en lugar de instanciar `rateLimit(...)` en cada router)
 * evita duplicación de configuración y permite cambiar las políticas en un
 * solo lugar.
 *
 * Las cabeceras estándar `RateLimit-*` están activadas; las legacy `X-RateLimit-*`
 * desactivadas (recomendación oficial de `express-rate-limit`).
 *
 * Si el front detecta un 429, debe respetar la cabecera `Retry-After`.
 */

const commonOptions = {
    standardHeaders: 'draft-7' as const,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Demasiadas peticiones, intenta más tarde',
        code: 'TOO_MANY_REQUESTS',
        statusCode: 429,
    },
};

/**
 * Limiter estricto para endpoints de autenticación (login, register,
 * verify-code, cancel-verification). Diseñado para mitigar fuerza bruta
 * y enumeración: pocas peticiones por IP en ventanas cortas.
 *
 *  - **Ventana**: 15 minutos.
 *  - **Máximo**: 20 peticiones por IP en la ventana.
 */
export const authRateLimiter: RateLimitRequestHandler = rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    limit: 20,
});

/**
 * Limiter general para endpoints autenticados de uso normal
 * (gestión de allowed-emails, sesión, logout, etc.).
 *
 *  - **Ventana**: 15 minutos.
 *  - **Máximo**: 100 peticiones por IP en la ventana.
 */
export const generalRateLimiter: RateLimitRequestHandler = rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    limit: 100,
});

/**
 * Limiter relajado para endpoints administrativos del consumer de Kafka.
 * Estos endpoints suelen invocarse muy pocas veces por sesión.
 *
 *  - **Ventana**: 5 minutos.
 *  - **Máximo**: 30 peticiones por IP en la ventana.
 */
export const adminRateLimiter: RateLimitRequestHandler = rateLimit({
    ...commonOptions,
    windowMs: 5 * 60 * 1000,
    limit: 30,
});
