import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../../src/common/errors';
import { EstadoAdmin, validarCambioActivo, validarCambioRol } from '../../../src/modules/users/reglas-roles';

/** Administrador con rol `root`. */
const root = (id: number, activo = true): EstadoAdmin => ({ id, rol: 'root', activo });
/** Administrador con rol `admin`. */
const admin = (id: number, activo = true): EstadoAdmin => ({ id, rol: 'admin', activo });

describe('validarCambioRol', () => {
    it('permite ascender a root', () => {
        expect(() => validarCambioRol([root(1), admin(2)], 2, 'root')).not.toThrow();
    });

    it('permite quitar root si queda otro root activo', () => {
        expect(() => validarCambioRol([root(1), root(2)], 2, 'admin')).not.toThrow();
    });

    it('impide quitar root al último root activo', () => {
        expect(() => validarCambioRol([root(1), admin(2)], 1, 'admin')).toThrow(ConflictError);
    });

    it('no cuenta como root disponible a uno desactivado', () => {
        expect(() => validarCambioRol([root(1), root(2, false)], 1, 'admin')).toThrow(ConflictError);
    });

    it('rechaza un administrador inexistente', () => {
        expect(() => validarCambioRol([root(1)], 9, 'admin')).toThrow(NotFoundError);
    });
});

describe('validarCambioActivo', () => {
    it('permite desactivar a un admin', () => {
        expect(() => validarCambioActivo([root(1), admin(2)], 1, 2, false)).not.toThrow();
    });

    it('impide desactivarse a uno mismo', () => {
        expect(() => validarCambioActivo([root(1), root(2)], 1, 1, false)).toThrow(ConflictError);
    });

    it('impide desactivar al último root activo', () => {
        expect(() => validarCambioActivo([root(1), root(2, false), admin(3)], 3, 1, false)).toThrow(ConflictError);
    });

    it('permite reactivar siempre', () => {
        expect(() => validarCambioActivo([root(1), admin(2, false)], 1, 2, true)).not.toThrow();
    });
});
