import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { container } from 'tsyringe';
import { errorHandler, notFoundHandler } from '../../../src/common/middlewares/error-handler.middleware';
import { asyncHandler } from '../../../src/common/middlewares/async-handler';
import { requestIdMiddleware } from '../../../src/common/middlewares/request-id.middleware';
import { LoggerService } from '../../../src/common/logger/logger.service';
import { ConflictError, InvalidVerificationCodeError } from '../../../src/common/errors';
import { definido, loggerFalso, nextFalso, reqFalsa, resFalsa } from '../../helpers/dobles';

/** Lo que se lanza cuando alguien hace `throw` sin valor. */
const SIN_VALOR: unknown = undefined;

/** ZodError real producido por un correo inválido. */
const errorZod = () => definido(z.object({ correo: z.string().email() }).safeParse({ correo: 'no' }).error, 'un ZodError');

/** Ejecuta `fn` con `NODE_ENV` cambiado y lo restaura aunque falle. */
const conEntorno = async (modo: string, fn: () => void | Promise<void>) => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = modo;
    try {
        await fn();
    } finally {
        process.env.NODE_ENV = original;
    }
};

let logger: ReturnType<typeof loggerFalso>;
/** Pasa el error por el manejador con un logger falso y devuelve la respuesta. */
const manejar = (err: unknown, req = reqFalsa({ requestId: 'r-1' })) => {
    logger = loggerFalso();
    container.registerInstance(LoggerService, logger);
    const res = resFalsa();
    errorHandler(err, req, res, nextFalso());
    return res;
};

afterEach(() => container.clearInstances());

describe('errorHandler', () => {
    it('un error de negocio usa su estado y se registra como aviso', () => {
        const res = manejar(new ConflictError('Ya existe'));
        expect(res.statusCode).toBe(409);
        expect(res.cuerpo).toEqual({ success: false, message: 'Ya existe', code: 'CONFLICT', statusCode: 409 });
        expect(logger.warn).toHaveBeenCalledWith('[r-1] CONFLICT 409: Ya existe');
    });

    it('incluye el detalle fuera de producción y lo omite en producción', async () => {
        expect(manejar(new InvalidVerificationCodeError(2)).cuerpo).toMatchObject({ details: { attemptsLeft: 2 } });
        await conEntorno('production', () => {
            expect(manejar(new InvalidVerificationCodeError(2)).cuerpo).not.toHaveProperty('details');
        });
    });

    it('un ZodError es un 400 con la ruta de cada problema', async () => {
        const res = manejar(errorZod());
        expect(res.statusCode).toBe(400);
        expect(res.cuerpo).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path: 'correo', message: expect.any(String) }] } });
        await conEntorno('production', () => {
            expect(manejar(errorZod()).cuerpo).not.toHaveProperty('details');
        });
    });

    it('un error desconocido es 500, se registra como error y oculta el mensaje en producción', async () => {
        const res = manejar(new Error('detalle interno'), reqFalsa());
        expect(res.statusCode).toBe(500);
        expect(res.cuerpo).toMatchObject({ code: 'INTERNAL', message: 'detalle interno' });
        expect(logger.error.mock.calls[0][0]).toBe('[no-req-id] INTERNAL 500');

        await conEntorno('production', () => {
            expect(manejar(new Error('detalle interno')).cuerpo).toMatchObject({ message: 'Error interno del servidor' });
        });
    });

    it('tolera que se lance algo que no es un Error', () => {
        expect(manejar(SIN_VALOR).cuerpo).toMatchObject({ statusCode: 500, message: 'Error desconocido' });
    });
});

describe('notFoundHandler', () => {
    it('describe el método y la ruta', () => {
        const res = resFalsa();
        notFoundHandler(reqFalsa({ method: 'DELETE', originalUrl: '/api/x' }), res);
        expect(res.statusCode).toBe(404);
        expect(res.cuerpo).toEqual({ success: false, message: 'Ruta no encontrada: DELETE /api/x', code: 'NOT_FOUND', statusCode: 404 });
    });
});

describe('asyncHandler', () => {
    it('pasa a next el rechazo del manejador', async () => {
        const error = new Error('x');
        const next = nextFalso();
        asyncHandler(() => Promise.reject(error))(reqFalsa(), resFalsa(), next);
        await new Promise((resolver) => {
            setImmediate(resolver);
        });
        expect(next).toHaveBeenCalledWith(error);
    });

    it('no llama a next si el manejador termina bien', async () => {
        const next = nextFalso();
        asyncHandler((_req, res) => {
            res.json({});
            return Promise.resolve();
        })(reqFalsa(), resFalsa(), next);
        await new Promise((resolver) => {
            setImmediate(resolver);
        });
        expect(next).not.toHaveBeenCalled();
    });
});

describe('requestIdMiddleware', () => {
    it.each([
        ['genera uno si no llega', undefined],
        ['genera uno si llega vacío', ''],
    ])('%s', (_caso, entrante) => {
        const req = reqFalsa({ header: vi.fn(() => entrante) });
        const res = resFalsa();
        const next = nextFalso();
        requestIdMiddleware(req, res, next);
        expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
        expect(next).toHaveBeenCalledOnce();
    });
});
