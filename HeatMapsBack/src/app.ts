import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import { container } from 'tsyringe';
import { AppConfig } from './config/app.config';
import { decryptRequest, encryptResponse } from './middlewares/crypto.middleware';
import { errorHandler, notFoundHandler } from './common/middlewares/error-handler.middleware';
import { requestIdMiddleware } from './common/middlewares/request-id.middleware';
import { buildAuthRouter } from './modules/auth/auth.routes';
import { buildAllowedEmailsRouter } from './modules/allowed-emails/allowed-emails.routes';
import { buildSensorRouter } from './modules/sensor/sensor.routes';
import { buildMetricsRouter } from './modules/metrics/metrics.routes';
import { buildUsersRouter } from './modules/users/users.routes';
import { buildReportesRouter } from './modules/reportes/reportes.routes';
import { buildPublicoRouter } from './modules/publico/publico.routes';

/**
 * Construye y configura la aplicación Express.
 *
 * Orden del pipeline (importa que se respete):
 *  1. **`requestIdMiddleware`** — asigna un id único por petición.
 *  2. **`cors`** — CORS con origen configurable.
 *  3. **`express.json`** — parser de body JSON.
 *  4. **Health check** `/ping` — no pasa por cifrado ni auth.
 *  5. **Crypto middlewares** sobre `/api` y `/kafka` (descifra → cifra).
 *  6. **Routers de cada módulo**.
 *  7. **`notFoundHandler`** para rutas no registradas.
 *  8. **`errorHandler`** central (DEBE ser el último middleware).
 *
 * Esta función NO inicia el servidor (eso lo hace `index.ts`) ni inicializa
 * recursos externos (DB, Kafka). Solo retorna la `Application` lista para
 * ser pasada a `http.createServer(...)`.
 */
export const createApp = (): Application => {
    const app: Application = express();
    const cfg = container.resolve(AppConfig);

    app.disable('x-powered-by');

    app.use(requestIdMiddleware);
    app.use(cors({ origin: cfg.corsOrigin }));
    app.use(express.json({ limit: '1mb' }));

    app.get('/ping', (_req: Request, res: Response) => {
        res.json({ message: 'pong' });
    });

    app.use('/api', decryptRequest, encryptResponse);
    app.use('/kafka', decryptRequest, encryptResponse);

    app.use('/api/publico', buildPublicoRouter());
    app.use('/api/auth', buildAuthRouter());
    app.use('/api/allowed-emails', buildAllowedEmailsRouter());
    app.use('/api/users', buildUsersRouter());
    app.use('/api/metrics', buildMetricsRouter());
    app.use('/api/reportes', buildReportesRouter());
    app.use('/kafka', buildSensorRouter());

    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
};
