import { singleton } from 'tsyringe';
import { EnvService } from '../common/env/env.service';

/**
 * Parámetros del subsistema de sensado: anonimización, modelo de propagación
 * y ventanas de agregación.
 *
 * Todos son recalibrables por entorno a propósito. El exponente de atenuación
 * y el RSSI de referencia dependen del espacio físico (materiales, obstáculos,
 * altura del nodo) y no admiten un valor fijado en código: los valores por
 * defecto vienen de literatura y se ajustan por medición en cada despliegue.
 */
@singleton()
export class SensingConfig {
    /** Clave HMAC de anonimizacion, convertida una sola vez a Buffer. */
    private readonly _macHashKey: Buffer;

    constructor(private readonly env: EnvService) {
        this._macHashKey = Buffer.from(env.get('MAC_HASH_KEY'), 'hex');
    }

    /** Clave HMAC-SHA256 con la que se anonimizan las direcciones MAC. */
    get macHashKey(): Buffer {
        return this._macHashKey;
    }

    /** Potencia recibida de referencia a un metro, en dBm. */
    get rssiReferenceDbm(): number {
        return this.env.get('RSSI_REFERENCE_DBM');
    }

    /** Exponente de atenuación del entorno (≈2 espacio libre, 2.7–4 interiores). */
    get pathLossExponent(): number {
        return this.env.get('PATH_LOSS_EXPONENT');
    }

    /** Duración de la ventana de agregación de ocupación, en minutos. */
    get aggregationIntervalMinutes(): number {
        return this.env.get('AGGREGATION_INTERVAL_MINUTES');
    }

    /** Fracción del aforo desde la que la ocupación es alta. */
    get occupancyHighRatio(): number {
        return this.env.get('OCCUPANCY_HIGH_RATIO');
    }

    /** Fracción del aforo desde la que la ocupación es media. */
    get occupancyMediumRatio(): number {
        return this.env.get('OCCUPANCY_MEDIUM_RATIO');
    }
}
