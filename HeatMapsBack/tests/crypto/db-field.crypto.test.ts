import { describe, expect, it, beforeAll } from 'vitest';
import { container } from 'tsyringe';
import { DbFieldCipher } from '../../src/crypto/db-field.crypto';

describe('DbFieldCipher', () => {
    let cipher: DbFieldCipher;

    beforeAll(() => {
        cipher = container.resolve(DbFieldCipher);
    });

    it('encrypt → decrypt es un round-trip', () => {
        const plain = 'usuario@example.com';
        const ct = cipher.encrypt(plain);
        expect(ct).not.toContain(plain);
        expect(cipher.decrypt(ct)).toBe(plain);
    });

    it('encrypt produce ciphertexts distintos para el mismo input (IV aleatorio)', () => {
        const first = cipher.encrypt('foo');
        const second = cipher.encrypt('foo');
        expect(first).not.toBe(second);
    });

    it('hash es determinista, case-insensitive y trimea', () => {
        expect(cipher.hash('Hola')).toBe(cipher.hash('hola'));
        expect(cipher.hash('  hola  ')).toBe(cipher.hash('hola'));
    });

    it('decrypt falla si el ciphertext fue manipulado', () => {
        const ct = cipher.encrypt('test');
        const tampered = ct.slice(0, -2) + (ct.slice(-2) === 'AA' ? 'BB' : 'AA');
        expect(() => cipher.decrypt(tampered)).toThrow();
    });
});
