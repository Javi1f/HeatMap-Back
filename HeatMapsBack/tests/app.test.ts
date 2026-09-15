import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { container } from 'tsyringe';
import type { Application, Request, Response } from 'express';
import { createApp } from '../src/app';
import { ApiPayloadCipher } from '../src/crypto/api-payload.crypto';
import { JwtService } from '../src/modules/auth/services/jwt.service';
import { SessionService } from '../src/modules/auth/services/session.service';
import { AdminRepository } from '../src/modules/auth/repositories/admin.repository';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AllowedEmailsController } from '../src/modules/allowed-emails/allowed-emails.controller';
import { UsersController } from '../src/modules/users/users.controller';
import { MetricsController } from '../src/modules/metrics/metrics.controller';
import { ReportesController } from '../src/modules/reportes/reportes.controller';
import { PublicoController } from '../src/modules/publico/publico.controller';
import { SensorController } from '../src/modules/sensor/sensor.controller';
import { ValidationError } from '../src/common/errors';
import { silenciar } from './helpers/dobles';

/*
 * Prueba del cableado HTTP: rutas, orden de middlewares, cifrado, autenticación,
 * roles, validación y manejo de errores. Los controladores son dobles que
 * responden con el nombre de la acción, así que lo que se comprueba es qué
 * petición llega a cuál y con qué datos, no la lógica de negocio.
 */

const cifrador = container.resolve(ApiPayloadCipher);
const jwt = container.resolve(JwtService);

/** Controlador falso: cada acción responde `{ accion, body, params, query }`. */
const controladorFalso = (acciones: string[]) =>
    Object.fromEntries(acciones.map((accion) => [accion, vi.fn((req: Request, res: Response) => {
        res.status(200).json({ accion, body: req.body, params: req.params, query: req.query, admin: req.admin?.id ?? null });
        return Promise.resolve();
    })]));

const admins: Record<number, { rol: string; activo: boolean }> = { 1: { rol: 'root', activo: true }, 2: { rol: 'admin', activo: true } };
/** JWT válido para el administrador simulado con ese id. */
const tokenDe = (id: number) => jwt.sign({ id, username: `u${id}`, email: `u${id}@b.co`, rol: admins[id].rol as 'root' });
const ROOT = `Bearer ${tokenDe(1)}`;
const ADMIN = `Bearer ${tokenDe(2)}`;

/** Descifra el sobre `{ data }` de una respuesta de la API. */
const descifrar = (cuerpo: { data: string }) => cifrador.decrypt(cuerpo.data) as Record<string, unknown>;
/** Envuelve un cuerpo en el sobre cifrado que espera la API. */
const cifrado = (datos: unknown) => ({ data: cifrador.encrypt(datos) });

let app: Application;
let publico: Record<string, ReturnType<typeof vi.fn>>;

beforeAll(() => {
    container.registerInstance(SessionService, { isActive: vi.fn(() => Promise.resolve(true)) } as never);
    container.registerInstance(AdminRepository, { findById: vi.fn((id: number) => Promise.resolve(admins[id] ?? null)) } as never);

    publico = controladorFalso(['zonas', 'mapa']);
    container.registerInstance(PublicoController, publico as never);
    container.registerInstance(AuthController, controladorFalso(['login', 'register', 'verifyCode', 'cancelVerification', 'logout', 'session']) as never);
    container.registerInstance(AllowedEmailsController, controladorFalso(['getAll', 'add', 'remove']) as never);
    container.registerInstance(UsersController, controladorFalso(['listAdmins', 'cambiarRol', 'cambiarActivo', 'listSessions', 'revokeSession', 'listarAuditoria']) as never);
    container.registerInstance(MetricsController, { ...controladorFalso(['overview', 'zones', 'occupancy', 'sensors', 'alerts', 'resolveAlert']), parameters: (_req: Request, res: Response) => { res.json({ accion: 'parameters' }); } } as never);
    container.registerInstance(ReportesController, controladorFalso(['crear', 'listar', 'obtener', 'exportarCsv', 'eliminar']) as never);
    container.registerInstance(SensorController, { ...controladorFalso(['start', 'stop']), status: (_req: Request, res: Response) => { res.json({ accion: 'status' }); } } as never);

    vi.spyOn(console, 'warn').mockImplementation(silenciar);
    vi.spyOn(console, 'error').mockImplementation(silenciar);
    app = createApp();
});

describe('Aplicación: infraestructura', () => {
    it('/ping responde sin cifrar, sin cabecera x-powered-by y con id de petición', async () => {
        const res = await request(app).get('/ping');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: 'pong' });
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('respeta el id de petición entrante', async () => {
        const res = await request(app).get('/ping').set('X-Request-Id', 'traza-123');
        expect(res.headers['x-request-id']).toBe('traza-123');
    });

    it('una ruta inexistente fuera de /api responde 404 en claro', async () => {
        const res = await request(app).get('/nada');
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, code: 'NOT_FOUND', message: 'Ruta no encontrada: GET /nada' });
    });

    it('bajo /api también el 404 viaja cifrado', async () => {
        const res = await request(app).get('/api/nada');
        expect(res.status).toBe(404);
        expect(Object.keys(res.body)).toEqual(['data']);
        expect(descifrar(res.body)).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('un cuerpo cifrado corrupto responde 400, en claro porque no se llegó a instalar el cifrado de la respuesta', async () => {
        const res = await request(app).post('/api/auth/login').send({ data: 'basura' });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', message: 'Payload cifrado inválido o clave incorrecta' });
    });

    it('anuncia las cabeceras estándar de límite de peticiones', async () => {
        const res = await request(app).get('/api/publico/zonas');
        expect(res.headers.ratelimit ?? res.headers['ratelimit-policy']).toBeDefined();
    });
});

describe('Aplicación: vista pública y autenticación', () => {
    it('la vista pública no exige token', async () => {
        const res = await request(app).get('/api/publico/mapa?zonaId=z1');
        expect(res.status).toBe(200);
        expect(descifrar(res.body)).toMatchObject({ accion: 'mapa', query: { zonaId: 'z1' } });
    });

    it('descifra el cuerpo, lo valida y lo entrega normalizado al controlador', async () => {
        const res = await request(app).post('/api/auth/cancel-verification').send(cifrado({ email: '  Ana@Unbosque.edu.co ' }));
        expect(res.status).toBe(200);
        expect(descifrar(res.body)).toMatchObject({ accion: 'cancelVerification', body: { email: 'ana@unbosque.edu.co' } });
    });

    it('rechaza con 400 y detalle un cuerpo que no cumple el esquema', async () => {
        const res = await request(app).post('/api/auth/login').send(cifrado({ username: '' }));
        expect(res.status).toBe(400);
        const cuerpo = descifrar(res.body);
        expect(cuerpo.code).toBe('VALIDATION_FAILED');
        expect((cuerpo.details as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    });

    it.each([
        ['post', '/api/auth/register'],
        ['post', '/api/auth/verify-code'],
    ] as const)('%s %s valida su cuerpo', async (metodo, ruta) => {
        const res = await request(app)[metodo](ruta).send(cifrado({}));
        expect(res.status).toBe(400);
    });

    it.each([
        ['post', '/api/auth/logout'],
        ['get', '/api/auth/session'],
        ['get', '/api/metrics/overview'],
        ['get', '/api/reportes'],
        ['get', '/kafka/status'],
        ['get', '/api/users/admins'],
        ['get', '/api/allowed-emails'],
    ] as const)('%s %s exige token', async (metodo, ruta) => {
        const res = await request(app)[metodo](ruta);
        expect(res.status).toBe(401);
        expect(descifrar(res.body)).toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('con token válido llega al controlador con el administrador adjunto', async () => {
        const res = await request(app).get('/api/auth/session').set('Authorization', ADMIN);
        expect(descifrar(res.body)).toMatchObject({ accion: 'session', admin: 2 });
    });
});

describe('Aplicación: rutas de panel', () => {
    it.each([
        '/api/metrics/overview', '/api/metrics/zones', '/api/metrics/occupancy?hours=3', '/api/metrics/sensors',
        '/api/metrics/alerts', '/api/metrics/parameters', '/api/reportes', '/kafka/status',
    ])('GET %s es accesible a cualquier admin', async (ruta) => {
        const res = await request(app).get(ruta).set('Authorization', ADMIN);
        expect(res.status).toBe(200);
    });

    it('resolver una alerta llega con el id de la ruta', async () => {
        const res = await request(app).post('/api/metrics/alerts/a1/resolve').set('Authorization', ADMIN);
        expect(descifrar(res.body)).toMatchObject({ accion: 'resolveAlert', params: { id: 'a1' } });
    });

    it('los reportes validan el rango y el UUID', async () => {
        const malo = await request(app).post('/api/reportes').set('Authorization', ADMIN)
            .send(cifrado({ tipoReporte: 'alertas', rangoInicio: '2026-09-02', rangoFin: '2026-09-01' }));
        expect(malo.status).toBe(400);

        const bueno = await request(app).post('/api/reportes').set('Authorization', ADMIN)
            .send(cifrado({ tipoReporte: 'alertas', rangoInicio: '2026-09-01', rangoFin: '2026-09-02' }));
        expect(descifrar(bueno.body)).toMatchObject({ accion: 'crear' });

        expect((await request(app).get('/api/reportes/no-uuid').set('Authorization', ADMIN)).status).toBe(400);
        const uuid = '3f2c9a1e-8b7d-4c6e-9f0a-1b2c3d4e5f60';
        const casos = [['get', `/api/reportes/${uuid}`, 'obtener'], ['get', `/api/reportes/${uuid}/csv`, 'exportarCsv'], ['delete', `/api/reportes/${uuid}`, 'eliminar']] as const;
        const respuestas = await Promise.all(casos.map(([metodo, ruta]) => request(app)[metodo](ruta).set('Authorization', ADMIN)));
        respuestas.forEach((res, indice) => {
            expect(descifrar(res.body)).toMatchObject({ accion: casos[indice][2], params: { id: uuid } });
        });
    });
});

describe('Aplicación: rol root', () => {
    it.each([
        ['get', '/api/users/admins'],
        ['get', '/api/allowed-emails'],
        ['post', '/kafka/start'],
        ['post', '/kafka/stop'],
    ] as const)('%s %s responde 403 a un admin', async (metodo, ruta) => {
        const res = await request(app)[metodo](ruta).set('Authorization', ADMIN);
        expect(res.status).toBe(403);
        expect(descifrar(res.body)).toMatchObject({ code: 'FORBIDDEN' });
    });

    it.each([
        ['get', '/api/users/admins', 'listAdmins'],
        ['get', '/api/users/sessions', 'listSessions'],
        ['delete', '/api/users/sessions/s1', 'revokeSession'],
        ['get', '/api/allowed-emails', 'getAll'],
        ['post', '/kafka/start', 'start'],
        ['post', '/kafka/stop', 'stop'],
    ] as const)('%s %s llega al controlador con root', async (metodo, ruta, accion) => {
        const res = await request(app)[metodo](ruta).set('Authorization', ROOT);
        expect(res.status).toBe(200);
        expect(descifrar(res.body)).toMatchObject({ accion });
    });

    it('gestión de usuarios: valida id, rol, activo y límite de auditoría', async () => {
        const rol = await request(app).patch('/api/users/admins/2/rol').set('Authorization', ROOT).send(cifrado({ rol: 'root' }));
        expect(descifrar(rol.body)).toMatchObject({ accion: 'cambiarRol', params: { id: 2 }, body: { rol: 'root' } });

        expect((await request(app).patch('/api/users/admins/x/rol').set('Authorization', ROOT).send(cifrado({ rol: 'root' }))).status).toBe(400);
        expect((await request(app).patch('/api/users/admins/2/rol').set('Authorization', ROOT).send(cifrado({ rol: 'dios' }))).status).toBe(400);

        const activo = await request(app).patch('/api/users/admins/2/activo').set('Authorization', ROOT).send(cifrado({ activo: false }));
        expect(descifrar(activo.body)).toMatchObject({ accion: 'cambiarActivo', body: { activo: false } });

        const auditoria = await request(app).get('/api/users/auditoria').set('Authorization', ROOT);
        expect(descifrar(auditoria.body)).toMatchObject({ accion: 'listarAuditoria', query: { limite: 100 } });
        expect((await request(app).get('/api/users/auditoria?limite=9999').set('Authorization', ROOT)).status).toBe(400);
    });

    it('lista blanca: valida el correo y el id', async () => {
        const alta = await request(app).post('/api/allowed-emails').set('Authorization', ROOT).send(cifrado({ email: 'Nuevo@B.co' }));
        expect(descifrar(alta.body)).toMatchObject({ accion: 'add', body: { email: 'nuevo@b.co' } });
        expect((await request(app).post('/api/allowed-emails').set('Authorization', ROOT).send(cifrado({ email: 'no' }))).status).toBe(400);

        const baja = await request(app).delete('/api/allowed-emails/7').set('Authorization', ROOT);
        expect(descifrar(baja.body)).toMatchObject({ accion: 'remove', params: { id: 7 } });
        expect((await request(app).delete('/api/allowed-emails/-1').set('Authorization', ROOT)).status).toBe(400);
    });
});

describe('Aplicación: errores', () => {
    it('un error de la aplicación conserva su código y estado', async () => {
        publico.zonas.mockRejectedValueOnce(new ValidationError('Nada que ver', { campo: 'x' }));
        const res = await request(app).get('/api/publico/zonas');
        expect(res.status).toBe(400);
        expect(descifrar(res.body)).toEqual({ success: false, message: 'Nada que ver', code: 'VALIDATION_FAILED', statusCode: 400, details: { campo: 'x' } });
    });

    it('un error inesperado responde 500 y se registra', async () => {
        publico.zonas.mockRejectedValueOnce(new Error('explotó'));
        const res = await request(app).get('/api/publico/zonas');
        expect(res.status).toBe(500);
        expect(descifrar(res.body)).toMatchObject({ code: 'INTERNAL', message: 'explotó' });
        expect(console.error).toHaveBeenCalled(); // skipcq: JS-0002
    });

    it('frena la fuerza bruta en el login con 429', async () => {
        let ultimo = 0;
        // En serie a propósito: el limitador cuenta las peticiones en orden de llegada.
        for (let i = 0; i < 21; i++) {
            ultimo = (await request(app).post('/api/auth/login').send(cifrado({ username: 'ana', password: 'x' }))).status; // skipcq: JS-0032
        }
        expect(ultimo).toBe(429);
    });
});
