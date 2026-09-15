import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../../src/common/middlewares/validate.middleware';

/** Petición cuyo `query` es un getter sin setter, como en Express 5. */
const peticionExpress5 = (query: Record<string, unknown>): Request => {
    const req = { body: {} } as Request;
    Object.defineProperty(req, 'query', { get: () => query, configurable: true, enumerable: true });
    return req;
};

describe('validate', () => {
    it('sustituye la consulta por la versión validada aunque query sea de solo lectura', () => {
        const req = peticionExpress5({ limite: '20' });
        const next = vi.fn();

        validate(z.object({ limite: z.coerce.number() }), 'query')(req, {} as Response, next);

        expect(req.query).toEqual({ limite: 20 });
        expect(next).toHaveBeenCalledOnce();
    });

    it('aplica los valores por defecto del esquema', () => {
        const req = peticionExpress5({});
        validate(z.object({ limite: z.coerce.number().default(100) }), 'query')(req, {} as Response, vi.fn());
        expect(req.query).toEqual({ limite: 100 });
    });

    it('descarta los campos no declarados del cuerpo', () => {
        const req = { body: { rol: 'admin', extra: 'x' } } as Request;
        validate(z.object({ rol: z.string() }))(req, {} as Response, vi.fn());
        expect(req.body).toEqual({ rol: 'admin' });
    });

    it('lanza ante datos inválidos', () => {
        const req = { body: { rol: 3 } } as Request;
        expect(() => validate(z.object({ rol: z.string() }))(req, {} as Response, vi.fn())).toThrow();
    });
});
