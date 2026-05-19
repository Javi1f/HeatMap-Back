import { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { KafkaConsumerService } from './services/kafka-consumer.service';
import { MESSAGES } from '../../constants/messages';

/**
 * Controlador HTTP para operar el ciclo de vida del consumidor de Kafka.
 *
 * Endpoints administrativos: iniciar/detener/consultar el estado del
 * consumer. Estas rutas suelen estar protegidas por autenticación si la
 * configuración del proyecto lo requiere (montaje en `app.ts`).
 */
@injectable()
export class SensorController {
    constructor(private readonly consumer: KafkaConsumerService) {}

    /**
     * `POST /kafka/start` — arranca el consumer si no está corriendo.
     * Idempotente: si ya corría, responde 200 sin error.
     */
    start = async (_req: Request, res: Response): Promise<void> => {
        await this.consumer.start();
        res.status(200).json({ success: true, message: MESSAGES.CONSUMER.STARTED });
    };

    /**
     * `POST /kafka/stop` — detiene el consumer. Idempotente.
     */
    stop = async (_req: Request, res: Response): Promise<void> => {
        await this.consumer.stop();
        res.status(200).json({ success: true, message: MESSAGES.CONSUMER.STOPPED });
    };

    /**
     * `GET /kafka/status` — devuelve si el consumer está corriendo.
     * Útil para dashboards de operación.
     */
    status = (_req: Request, res: Response): void => {
        const running = this.consumer.running;
        res.status(200).json({
            success: true,
            running,
            status: running ? 'active' : 'stopped',
        });
    };
}
