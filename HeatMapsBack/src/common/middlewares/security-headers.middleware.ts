import { NextFunction, Request, Response } from 'express';

/**
 * Cabeceras de seguridad en **todas** las respuestas HTTP del backend.
 *
 * Motivación: el escaneo con OWASP ZAP ( informe del 27-10-2026 ) reportó la
 * ausencia de cabeceras de endurecimiento en las respuestas. Como esta API
 * sólo habla JSON, se aplican cabeceras estrictas:
 *
 * - `X-Content-Type-Options: nosniff` — el navegador nunca adivina el tipo
 *   del cuerpo; evita la subida de contenido interpretado.
 * - `X-Frame-Options: DENY` + `frame-ancestors 'none'` — impide que la API se
 *   incruste en un `<iframe>` (anti-clickjacking, finding de ZAP 10020).
 * - `Content-Security-Policy` — como no hay HTML/JS activo, se niega todo
 *   recurso por defecto; reduce la superficie si un día se devuelve HTML.
 * - `Referrer-Policy: no-referrer` — las URLs internas no se filtran en el
 *   header Referer (finding de ZAP sobre información sensible en URL).
 * - `Permissions-Policy` — se desactivan APIs del navegador que la API no usa.
 *
 * Se registra como el primer middleware después del `requestIdMiddleware`
 * para que también afecte a las respuestas del `errorHandler`
 * (las cabeceras fijadas en `res` persisten aunque el handler sea el último).
 */
export function securityHeadersMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    next();
}
