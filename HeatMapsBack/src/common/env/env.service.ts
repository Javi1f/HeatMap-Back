import { singleton } from 'tsyringe';
import { Env, envSchema } from './env.schema';

/**
 * Servicio singleton de acceso tipado a las variables de entorno.
 *
 * Realiza la validación con Zod la primera vez que se construye (lazy).
 * Si la validación falla, lanza un error con el detalle de las variables
 * inválidas y la aplicación debe terminar.
 *
 * Uso típico:
 *
 *     const env = container.resolve(EnvService);
 *     const port = env.get('PORT');
 *
 * Reglas:
 *  - NUNCA leer `process.env` directamente fuera de este servicio.
 *  - Los demás servicios reciben este servicio por DI.
 *  - Si necesitas un subconjunto tipado de variables (ej. config de DB),
 *    crea un objeto de configuración en `src/config/` que dependa de este.
 */
@singleton()
export class EnvService {
    private readonly env: Env;

    constructor() {
        const result = envSchema.safeParse(process.env);
        if (!result.success) {
            const issues = result.error.issues
                .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
                .join('\n');
            throw new Error(`Variables de entorno inválidas:\n${issues}`);
        }
        this.env = result.data;
    }

    /**
     * Lee una variable de entorno ya validada y normalizada.
     *
     * @typeParam K - Nombre de la variable (autocompletado desde el esquema).
     * @returns El valor tipado.
     */
    get<K extends keyof Env>(key: K): Env[K] {
        return this.env[key];
    }

    /**
     * @returns `true` si la app corre en modo development.
     */
    isDevelopment(): boolean {
        return this.env.NODE_ENV === 'development';
    }

    /**
     * @returns `true` si la app corre en modo production.
     */
    isProduction(): boolean {
        return this.env.NODE_ENV === 'production';
    }

    /**
     * @returns `true` si la app corre en modo test.
     */
    isTest(): boolean {
        return this.env.NODE_ENV === 'test';
    }
}
