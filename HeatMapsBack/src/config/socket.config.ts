import { singleton } from 'tsyringe';
import { AppConfig } from './app.config';

/**
 * Opciones de creación del servidor Socket.IO.
 *
 * Esta clase NO crea el servidor (eso lo hace `SocketEmitterService` en el
 * módulo `sensor`), solo proporciona los parámetros tipados.
 */
@singleton()
export class SocketConfig {
    /**
     * Métodos HTTP permitidos en el handshake de Socket.IO.
     *
     * Es una constante del protocolo, no depende del estado de la instancia,
     * por eso se expone como `readonly` en lugar de getter.
     */
    public readonly corsMethods: string[] = ['GET', 'POST'];

    constructor(private readonly appConfig: AppConfig) {}

    /** Origen permitido para handshake CORS. */
    get corsOrigin(): string {
        return this.appConfig.corsOrigin;
    }
}
