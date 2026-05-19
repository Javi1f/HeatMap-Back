import dotenv from 'dotenv';
import { dirname, resolve } from 'path';

/**
 * Carga del archivo `.env` antes que cualquier otro módulo de la aplicación.
 *
 * Debe ser el **primer import** del entry point (`index.ts`) — y de cualquier
 * otro punto de entrada alternativo — porque varios módulos (config, env,
 * crypto, etc.) leen `process.env` durante su construcción.
 *
 * Por qué se resuelve la ruta a partir de `process.argv[1]` en lugar de
 * dejar que dotenv use `process.cwd()`:
 *  - El CWD depende de quién arranca el proceso (npm, WebStorm, Docker).
 *  - Usar la ruta del archivo de entrada garantiza que `.env` se busque
 *    SIEMPRE en `HeatMapsBack/.env`, sin importar desde dónde se lance:
 *      - dev:  `process.argv[1] = .../HeatMapsBack/src/index.ts`  →  `../.env`  →  `HeatMapsBack/.env` ✓
 *      - prod: `process.argv[1] = .../HeatMapsBack/dist/index.js` →  `../.env`  →  `HeatMapsBack/.env` ✓
 *
 * Si el archivo no existe, dotenv falla silenciosamente (no lanza). La
 * validación posterior con Zod en `EnvService` será la que detenga la app
 * con un mensaje claro si falta alguna variable obligatoria.
 */
const entryDir = dirname(process.argv[1]);
dotenv.config({ path: resolve(entryDir, '../.env') });
