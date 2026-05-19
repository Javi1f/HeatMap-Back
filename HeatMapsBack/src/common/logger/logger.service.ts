import { singleton } from 'tsyringe';

/**
 * Niveles de severidad estándar.
 */
export enum LogLevel {
    ERROR = 'ERROR',
    WARN = 'WARN',
    INFO = 'INFO',
    DEBUG = 'DEBUG',
}

/**
 * Contrato público del logger. Los servicios dependen de esta interface,
 * nunca de la implementación concreta, para poder mockearlo en tests.
 */
export interface ILogger {
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}

/**
 * Firma de un sink: dónde se escribe físicamente una línea ya formateada.
 *
 * Mantener esto como tipo permite cambiar `console.*` por Pino/Winston en
 * el futuro sin tocar la lógica de dispatch.
 */
type Sink = (line: string, ...args: unknown[]) => void;

/**
 * Logger por consola con timestamp ISO y nivel.
 *
 * Implementación basada en una **tabla de dispatch** (`sinks`) en lugar de
 * un `switch`. Ventajas:
 *  - Complejidad ciclomática constante (1) — la antigua era 6.
 *  - Añadir o quitar un nivel implica una entrada en la tabla, no más casos.
 *  - Cubre exhaustivamente todos los `LogLevel` (TypeScript lo verifica
 *    estructuralmente al construir el `Record<LogLevel, Sink>`).
 *
 * En producción (`NODE_ENV === 'production'`) el sink de DEBUG se sustituye
 * por uno no-op, evitando ruido en logs sin necesidad de condicionales.
 *
 * Para integrar con un sistema externo (ELK, Datadog, Pino), reemplaza esta
 * clase por otra que implemente {@link ILogger} y regístrala en el contenedor DI.
 */
@singleton()
export class LoggerService implements ILogger {
    private readonly isDevelopment = process.env.NODE_ENV !== 'production';
    private readonly sinks: Record<LogLevel, Sink>;

    constructor() {
        const noop: Sink = () => {
            /* DEBUG silenciado en producción */
        };
        this.sinks = {
            [LogLevel.ERROR]: console.error.bind(console),
            [LogLevel.WARN]: console.warn.bind(console),
            [LogLevel.INFO]: console.log.bind(console),
            [LogLevel.DEBUG]: this.isDevelopment ? console.debug.bind(console) : noop,
        };
    }

    /**
     * Formatea la línea y delega en el sink correspondiente al nivel.
     *
     * @param level - Severidad del log.
     * @param message - Mensaje principal.
     * @param args - Argumentos adicionales (objetos, errores, etc.).
     */
    private write(level: LogLevel, message: string, ...args: unknown[]): void {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${level}] ${message}`;
        this.sinks[level](line, ...args);
    }

    /**
     * Registra un error grave (fallos irrecuperables, excepciones).
     */
    error(message: string, ...args: unknown[]): void {
        this.write(LogLevel.ERROR, message, ...args);
    }

    /**
     * Registra una advertencia (condición anómala pero recuperable).
     */
    warn(message: string, ...args: unknown[]): void {
        this.write(LogLevel.WARN, message, ...args);
    }

    /**
     * Registra información de uso normal (peticiones, conexiones, etc.).
     */
    info(message: string, ...args: unknown[]): void {
        this.write(LogLevel.INFO, message, ...args);
    }

    /**
     * Registra detalle de depuración. Solo visible si `NODE_ENV !== 'production'`.
     */
    debug(message: string, ...args: unknown[]): void {
        this.write(LogLevel.DEBUG, message, ...args);
    }
}
