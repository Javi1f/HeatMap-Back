import { describe, expect, it } from 'vitest';
import { loginSchema } from '../../../src/modules/auth/dto/login.dto';
import { registerSchema } from '../../../src/modules/auth/dto/register.dto';
import { verifyCodeSchema } from '../../../src/modules/auth/dto/verify-code.dto';

describe('loginSchema', () => {
    it('rechaza username vacío', () => {
        expect(loginSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    });
    it('acepta payload válido', () => {
        const result = loginSchema.safeParse({ username: '  jav  ', password: 'x' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.username).toBe('jav'); // trim
    });
});

describe('registerSchema', () => {
    it('rechaza email malformado', () => {
        const result = registerSchema.safeParse({
            username: 'jav',
            email: 'no-mail',
            password: '12345678',
        });
        expect(result.success).toBe(false);
    });
    it('rechaza username con caracteres inválidos', () => {
        const result = registerSchema.safeParse({
            username: 'ja v',
            email: 'a@b.com',
            password: '12345678',
        });
        expect(result.success).toBe(false);
    });
    it('rechaza password corto', () => {
        const result = registerSchema.safeParse({
            username: 'jav',
            email: 'a@b.com',
            password: '123',
        });
        expect(result.success).toBe(false);
    });
    it('normaliza email a minúsculas', () => {
        const result = registerSchema.safeParse({
            username: 'jav',
            email: 'AB@CD.com',
            password: '12345678',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.email).toBe('ab@cd.com');
    });
});

describe('verifyCodeSchema', () => {
    it('exige exactamente 5 dígitos', () => {
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '1234' }).success).toBe(false);
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '12a45' }).success).toBe(false);
        expect(verifyCodeSchema.safeParse({ email: 'a@b.com', code: '12345' }).success).toBe(true);
    });
});
