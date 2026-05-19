import { describe, expect, it } from 'vitest';
import {
    AppError,
    ConflictError,
    EmailNotAllowedError,
    ErrorCode,
    InvalidCredentialsError,
    InvalidVerificationCodeError,
    NotFoundError,
    TooManyAttemptsError,
    UnauthorizedError,
    ValidationError,
    VerificationCodeExpiredError,
} from '../../../src/common/errors';

describe('AppError jerarquía', () => {
    it('AppError.isAppError discrimina correctamente', () => {
        expect(AppError.isAppError(new ValidationError())).toBe(true);
        expect(AppError.isAppError(new Error('x'))).toBe(false);
        expect(AppError.isAppError('string')).toBe(false);
        expect(AppError.isAppError(null)).toBe(false);
    });

    it('ValidationError mapea a 400 con code VALIDATION_FAILED', () => {
        const err = new ValidationError('bad', { foo: 'bar' });
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
        expect(err.details).toEqual({ foo: 'bar' });
    });

    it('UnauthorizedError, NotFoundError, ConflictError mapean al status correcto', () => {
        expect(new UnauthorizedError().statusCode).toBe(401);
        expect(new NotFoundError().statusCode).toBe(404);
        expect(new ConflictError().statusCode).toBe(409);
    });

    it('InvalidCredentialsError es Unauthorized con code específico', () => {
        const err = new InvalidCredentialsError();
        expect(err.statusCode).toBe(401);
        expect(err.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    });

    it('InvalidVerificationCodeError incluye attemptsLeft en details', () => {
        const err = new InvalidVerificationCodeError(2);
        expect(err.statusCode).toBe(400);
        expect(err.details).toEqual({ attemptsLeft: 2 });
    });

    it('VerificationCodeExpiredError, TooManyAttemptsError, EmailNotAllowedError tienen códigos correctos', () => {
        expect(new VerificationCodeExpiredError().code).toBe(ErrorCode.VERIFICATION_CODE_EXPIRED);
        expect(new TooManyAttemptsError().code).toBe(ErrorCode.TOO_MANY_ATTEMPTS);
        expect(new EmailNotAllowedError().code).toBe(ErrorCode.EMAIL_NOT_ALLOWED);
    });
});
