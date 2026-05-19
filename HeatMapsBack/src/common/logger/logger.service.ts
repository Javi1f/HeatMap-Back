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
 * Logger por consola con timestamp ISO y nivel.
 *
 * En producción `DEBUG` se silencia automáticamente. Para integrar con un
 * sistema externo (ELK, Datadog, Pino), reemplaza esta clase por otra que
 * implemente {@link ILogger} y regístrala en el contenedor DI.
 */
@singleton()
export class LoggerService implements ILogger {
    private readonly isDevelopment = process.env.NODE_ENV !== 'production';

    private write(level: LogLevel, message: string, ...args: unknown[]): void {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${level}] ${message}`;
        switch (level) {
            case LogLevel.ERROR:
                console.error(line, ...args);
                break;
            case LogLevel.WARN:
                console.warn(line, ...args);
                break;
            case LogLevel.INFO:
                console.log(line, ...args);
                break;
            case LogLevel.DEBUG:
                if (this.isDevelopment) console.debug(line, ...args);
                break;
        }
    }

    error(message: string, ...args: unknown[]): void {
        this.write(LogLevel.ERROR, message, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        this.write(LogLevel.WARN, message, ...args);
    }

    info(message: string, ...args: unknown[]): void {
        this.write(LogLevel.INFO, message, ...args);
    }

    debug(message: string, ...args: unknown[]): void {
        this.write(LogLevel.DEBUG, message, ...args);
    }
}
