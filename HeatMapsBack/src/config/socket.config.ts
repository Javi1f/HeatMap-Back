import { singleton } from 'tsyringe';
import { AppConfig } from './app.config';

/**
 * Opciones de creación del servidor Socket.IO.
 *
 * Esta clase NO crea el servidor (eso lo hace `SocketServerProvider` en la
 * capa de infraestructura del módulo `sensor`), solo proporciona los
 * parámetros tipados.
 */
@singleton()
export class SocketConfig {
    constructor(private readonly appConfig: AppConfig) {}

    /** Origen permitido para handshake CORS. */
    get corsOrigin(): string {
        return this.appConfig.corsOrigin;
    }

    /** Métodos HTTP permitidos en el handshake de Socket.IO. */
    get corsMethods(): string[] {
        return ['GET', 'POST'];
    }
}
