import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';

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
 *  - Partir del archivo de entrada y subir hasta el directorio con
 *    `package.json` encuentra SIEMPRE `HeatMapsBack/.env`, se lance desde
 *    donde se lance y esté el punto de entrada a la profundidad que esté:
 *      - dev:     `src/index.ts`                 →  `HeatMapsBack/.env` ✓
 *      - prod:    `dist/index.js`                →  `HeatMapsBack/.env` ✓
 *      - scripts: `src/scripts/medir-dispositivo.ts` →  `HeatMapsBack/.env` ✓
 *
 * Una ruta fija como `../.env` sólo acertaba en los dos primeros casos.
 *
 * Si el archivo no existe, dotenv falla silenciosamente (no lanza). La
 * validación posterior con Zod en `EnvService` será la que detenga la app
 * con un mensaje claro si falta alguna variable obligatoria.
 */
/**
 * Directorio del proyecto que contiene al archivo de entrada: el primer
 * ascendiente con `package.json`.
 *
 * @returns Ese directorio o, si no hay ninguno, el padre del de entrada.
 */
const raizDelProyecto = (desde: string): string => {
    let actual = desde;
    while (!existsSync(join(actual, 'package.json'))) {
        const padre = dirname(actual);
        if (padre === actual) return resolve(desde, '..');
        actual = padre;
    }
    return actual;
};

// Sin archivo de entrada —`node -e` o una consola interactiva— se parte del
// directorio actual.
const origen = process.argv[1] ? dirname(process.argv[1]) : process.cwd();
dotenv.config({ path: join(raizDelProyecto(origen), '.env') });
