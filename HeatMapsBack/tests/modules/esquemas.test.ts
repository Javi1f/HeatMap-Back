import { describe, expect, it } from 'vitest';
import { addAllowedEmailSchema, allowedEmailIdParamSchema } from '../../src/modules/allowed-emails/dto/add-email.dto';
import { cancelVerificationSchema } from '../../src/modules/auth/dto/cancel-verification.dto';
import { adminIdParamSchema, auditoriaQuerySchema, cambiarActivoSchema, cambiarRolSchema } from '../../src/modules/users/dto/usuarios.dto';
import { TIPOS_REPORTE, crearReporteSchema, reporteIdParamSchema } from '../../src/modules/reportes/dto/reporte.dto';

describe('Esquemas de la lista blanca', () => {
    it('normaliza el correo y rechaza uno inválido', () => {
        expect(addAllowedEmailSchema.parse({ email: '  Ana@UNBOSQUE.edu.co ' })).toEqual({ email: 'ana@unbosque.edu.co' });
        expect(addAllowedEmailSchema.safeParse({ email: 'ana' }).success).toBe(false);
    });

    it('convierte el id de la ruta a entero positivo', () => {
        expect(allowedEmailIdParamSchema.parse({ id: '12' })).toEqual({ id: 12 });
        for (const id of ['0', '-3', '1.5', 'abc']) expect(allowedEmailIdParamSchema.safeParse({ id }).success).toBe(false);
    });
});

describe('Esquema de cancelación de registro', () => {
    it('exige un correo válido', () => {
        expect(cancelVerificationSchema.safeParse({ email: 'ana@unbosque.edu.co' }).success).toBe(true);
        expect(cancelVerificationSchema.safeParse({ email: 'x' }).success).toBe(false);
        expect(cancelVerificationSchema.safeParse({}).success).toBe(false);
    });
});

describe('Esquemas de gestión de usuarios', () => {
    it('id de administrador', () => {
        expect(adminIdParamSchema.parse({ id: '3' })).toEqual({ id: 3 });
        expect(adminIdParamSchema.safeParse({ id: 'x' }).success).toBe(false);
    });

    it('solo admite los roles root y admin', () => {
        expect(cambiarRolSchema.parse({ rol: 'root' })).toEqual({ rol: 'root' });
        expect(cambiarRolSchema.safeParse({ rol: 'superusuario' }).success).toBe(false);
    });

    it('activo tiene que ser booleano, no texto', () => {
        expect(cambiarActivoSchema.parse({ activo: false })).toEqual({ activo: false });
        expect(cambiarActivoSchema.safeParse({ activo: 'false' }).success).toBe(false);
    });

    it('límite de auditoría entre 1 y 500, 100 por defecto', () => {
        expect(auditoriaQuerySchema.parse({})).toEqual({ limite: 100 });
        expect(auditoriaQuerySchema.parse({ limite: '500' })).toEqual({ limite: 500 });
        expect(auditoriaQuerySchema.safeParse({ limite: '0' }).success).toBe(false);
        expect(auditoriaQuerySchema.safeParse({ limite: '501' }).success).toBe(false);
    });
});

describe('Esquemas de reportes', () => {
    const valido = { tipoReporte: 'serie_temporal', rangoInicio: '2026-09-01T00:00:00Z', rangoFin: '2026-09-02T00:00:00Z' };

    it('convierte el rango a fechas y admite los tres tipos', () => {
        for (const tipoReporte of TIPOS_REPORTE) {
            const resultado = crearReporteSchema.parse({ ...valido, tipoReporte });
            expect(resultado.rangoInicio).toBeInstanceOf(Date);
        }
        expect(crearReporteSchema.parse({ ...valido, idZona: ' z1 ' }).idZona).toBe('z1');
    });

    it('rechaza un rango invertido o vacío, un tipo desconocido y una zona demasiado larga', () => {
        const invertido = crearReporteSchema.safeParse({ ...valido, rangoFin: valido.rangoInicio });
        expect(invertido.success).toBe(false);
        expect(invertido.error?.issues[0].path).toEqual(['rangoFin']);
        expect(crearReporteSchema.safeParse({ ...valido, tipoReporte: 'otro' }).success).toBe(false);
        expect(crearReporteSchema.safeParse({ ...valido, idZona: 'x'.repeat(37) }).success).toBe(false);
        expect(crearReporteSchema.safeParse({ ...valido, rangoInicio: 'no-es-fecha' }).success).toBe(false);
    });

    it('el id de reporte es un UUID', () => {
        expect(reporteIdParamSchema.safeParse({ id: '3f2c9a1e-8b7d-4c6e-9f0a-1b2c3d4e5f60' }).success).toBe(true);
        expect(reporteIdParamSchema.safeParse({ id: '123' }).success).toBe(false);
    });
});
