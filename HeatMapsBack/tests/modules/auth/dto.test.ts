import { describe, expect, it } from 'vitest';
import { loginSchema } from '../../../src/modules/auth/dto/login.dto';
import { registerSchema } from '../../../src/modules/auth/dto/register.dto';
import { verifyCodeSchema } from '../../../src/modules/auth/dto/verify-code.dto';

describe('loginSchema', () => {
    it('rechaza username vacío', () => {
        expect(loginSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    });
    it('acepta payload válido', () => {
        const r = loginSchema.safeParse({ username: '  jav  ', password: 'x' });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.username).toBe('jav'); // trim
    });
});

describe('registerSchema', () => {
    it('rechaza email malformado', () => {
        const r = registerSchema.safeParse({ username: 'jav', email: 'no-mail', password: '12345678' });
        expect(r.success).toBe(false);
    });
    it('rechaza username con caracteres inválidos', () => {
        const r = registerSchema.safeParse({ username: 'ja v', email: 'a@b.com', password: '12345678' });
        expect(r.success).toBe(false);
    });
    it('rechaza password corto', () => {
        const r = registerSchema.safeParse({ username: 'jav', email: 'a@b.com', password: '123' });
        expect(r.success).toBe(false);
    });
    it('normaliza email a minúsculas', () => {
        const r = registerSchema.safeParse({
            username: 'jav',
            email: 'AB@CD.com',
            password: '12345678',
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.email).toBe('ab@cd.com');
    });
});

describe('verifyCodeSchema', () => {
    it('exige exactamente 5 dígitos', () => {
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '1234' }).success).toBe(false);
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '12a45' }).success).toBe(false);
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '12345' }).success).toBe(true);
    });
});
