import { singleton } from 'tsyringe';

/**
 * Niveles de severidad estándar.
 */
export enum LogLevel {
    /** Fallo que impide completar una operacion. */
    ERROR = 'ERROR',

    /** Situacion anomala de la que el sistema se recupera. */
    WARN = 'WARN',

    /** Hito normal del ciclo de vida. */
    INFO = 'INFO',

    /** Detalle de diagnostico. Silenciado en produccion. */
    DEBUG = 'DEBUG',
}

/**
 * Contrato público del logger. Los servicios dependen de esta interface,
 * nunca de la implementación concreta, para poder mockearlo en tests.
 */
export interface ILogger {
    /** Registra un fallo que impide completar una operacion. */
    error(message: string, ...args: unknown[]): void;

    /** Registra una anomalia de la que el sistema se recupera. */
    warn(message: string, ...args: unknown[]): void;

    /** Registra un hito normal del ciclo de vida. */
    info(message: string, ...args: unknown[]): void;

    /** Registra detalle de diagnostico. Silenciado en produccion. */
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
    /** `true` fuera de produccion. Decide si el nivel DEBUG llega a consola. */
    private readonly isDevelopment = process.env.NODE_ENV !== 'production';

    /**
     * Destino de cada nivel, resuelto una sola vez en el constructor. Evita
     * un `switch` por llamada y permite silenciar DEBUG sustituyendolo por
     * una funcion vacia en lugar de comprobar el entorno cada vez.
     */
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
