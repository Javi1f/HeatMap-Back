/**
 * Jerarquía de errores tipados de la aplicación.
 *
 * Todos los errores de negocio que el dominio o los servicios pueden producir
 * deben extender de {@link AppError}. El middleware central de errores
 * (`errorHandler`) los mapea a respuestas HTTP consistentes.
 *
 * NUNCA lanzar `Error` genéricos ni objetos literales (`throw { ... }`) desde
 * los servicios. Eso rompe el contrato de la capa de presentación y obliga al
 * controlador a saber detalles del error.
 */

/**
 * Códigos de error semánticos del dominio. Sirven al frontend para reaccionar
 * a errores específicos sin parsear mensajes.
 */
export enum ErrorCode {
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    NOT_FOUND = 'NOT_FOUND',
    CONFLICT = 'CONFLICT',
    INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
    INVALID_VERIFICATION_CODE = 'INVALID_VERIFICATION_CODE',
    VERIFICATION_CODE_EXPIRED = 'VERIFICATION_CODE_EXPIRED',
    TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS',
    EMAIL_NOT_ALLOWED = 'EMAIL_NOT_ALLOWED',
    INTERNAL = 'INTERNAL',
}

/**
 * Información adicional opcional asociada al error. Se serializa al cliente.
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * Error base de la aplicación. Todos los errores específicos del dominio
 * deben extender de esta clase.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: ErrorCode;
    public readonly details?: ErrorDetails;

    constructor(
        message: string,
        statusCode: number,
        code: ErrorCode = ErrorCode.INTERNAL,
        details?: ErrorDetails,
    ) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Error.captureStackTrace?.(this, this.constructor);
    }

    /**
     * Type guard para distinguir errores propios de errores arbitrarios.
     */
    static isAppError(err: unknown): err is AppError {
        return err instanceof AppError;
    }
}

/** 400 - Payload inválido o malformado. */
export class ValidationError extends AppError {
    constructor(message = 'Payload inválido', details?: ErrorDetails) {
        super(message, 400, ErrorCode.VALIDATION_FAILED, details);
    }
}

/** 401 - Falta autenticación o el token es inválido. */
export class UnauthorizedError extends AppError {
    constructor(message = 'No autenticado', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
        super(message, 401, code);
    }
}

/** 403 - Autenticado pero sin permiso para la operación. */
export class ForbiddenError extends AppError {
    constructor(message = 'Acceso prohibido', code: ErrorCode = ErrorCode.FORBIDDEN) {
        super(message, 403, code);
    }
}

/** 404 - Recurso no encontrado. */
export class NotFoundError extends AppError {
    constructor(message = 'Recurso no encontrado') {
        super(message, 404, ErrorCode.NOT_FOUND);
    }
}

/** 409 - Conflicto con estado existente (p.ej. unique constraint). */
export class ConflictError extends AppError {
    constructor(message = 'Conflicto con estado existente') {
        super(message, 409, ErrorCode.CONFLICT);
    }
}

/** Credenciales incorrectas (caso especial de 401). */
export class InvalidCredentialsError extends UnauthorizedError {
    constructor() {
        super('Credenciales incorrectas', ErrorCode.INVALID_CREDENTIALS);
    }
}

/**
 * Código de verificación incorrecto. Incluye `attemptsLeft` en details
 * para que el frontend pueda informar al usuario sin lógica extra.
 */
export class InvalidVerificationCodeError extends AppError {
    constructor(attemptsLeft: number) {
        super('Código incorrecto', 400, ErrorCode.INVALID_VERIFICATION_CODE, { attemptsLeft });
    }
}

/** Código de verificación expirado. */
export class VerificationCodeExpiredError extends AppError {
    constructor() {
        super('El código ha expirado, vuelve a registrarte', 400, ErrorCode.VERIFICATION_CODE_EXPIRED);
    }
}

/** Demasiados intentos fallidos de verificación. */
export class TooManyAttemptsError extends AppError {
    constructor() {
        super('Demasiados intentos fallidos, vuelve a registrarte', 400, ErrorCode.TOO_MANY_ATTEMPTS, {
            attemptsLeft: 0,
        });
    }
}

/** El correo no está en la lista blanca. */
export class EmailNotAllowedError extends ForbiddenError {
    constructor() {
        super('Este correo no está autorizado para registrarse', ErrorCode.EMAIL_NOT_ALLOWED);
    }
}
