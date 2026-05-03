enum LogLevel {
    ERROR = 'ERROR',
    WARN = 'WARN',
    INFO = 'INFO',
    DEBUG = 'DEBUG'
}

class Logger {
    private isDevelopment = process.env.NODE_ENV !== 'production';

    private log(level: LogLevel, message: string, ...args: any[]): void {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${level}] ${message}`;

        switch (level) {
            case LogLevel.ERROR:
                console.error(logMessage, ...args);
                break;
            case LogLevel.WARN:
                console.warn(logMessage, ...args);
                break;
            case LogLevel.INFO:
                console.log(logMessage, ...args);
                break;
            case LogLevel.DEBUG:
                if (this.isDevelopment) {
                    console.debug(logMessage, ...args);
                }
                break;
        }
    }

    error(message: string, ...args: any[]): void {
        this.log(LogLevel.ERROR, message, ...args);
    }

    warn(message: string, ...args: any[]): void {
        this.log(LogLevel.WARN, message, ...args);
    }

    info(message: string, ...args: any[]): void {
        this.log(LogLevel.INFO, message, ...args);
    }

    debug(message: string, ...args: any[]): void {
        this.log(LogLevel.DEBUG, message, ...args);
    }
}

export default new Logger();
