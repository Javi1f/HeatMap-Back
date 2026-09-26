import { singleton } from 'tsyringe';
import { SensingConfig } from '../../config/sensing.config';

/** Distancia máxima que se considera plausible para una detección Wi-Fi. */
const MAX_PLAUSIBLE_DISTANCE_M = 999.99;

/**
 * Estimación de distancia entre un dispositivo y el nodo que lo detecta, a
 * partir de la intensidad de señal recibida.
 *
 * Implementa el modelo de pérdida de propagación logarítmica:
 *
 *     d = 10 ^ ((RSSI₀ − RSSI) / (10·n))
 *
 * donde `RSSI₀` es la potencia de referencia a un metro y `n` el exponente de
 * atenuación del entorno.
 *
 * **Precisión esperada**: baja en términos absolutos. El modelo asume
 * propagación isótropa sin obstáculos, y un cuerpo humano entre dispositivo y
 * nodo introduce varios dB de atenuación. Sirve para ordenar detecciones por
 * cercanía y ponderar el mapa de calor, no para posicionar un dispositivo en
 * el plano. Los parámetros deben recalibrarse por espacio.
 */
@singleton()
export class DistanceEstimatorService {
    constructor(private readonly cfg: SensingConfig) {}

    /**
     * Estima la distancia en metros a partir del RSSI.
     *
     * @param rssi - Potencia recibida en dBm (valor negativo).
     * @returns Distancia redondeada a 2 decimales, o `null` si el RSSI no es
     *          un valor utilizable (0, positivo o no numérico), lo que ocurre
     *          cuando el driver no reporta potencia para esa trama.
     */
    estimate(rssi: number): number | null {
        if (!Number.isFinite(rssi) || rssi >= 0) return null;

        const exponent = (this.cfg.rssiReferenceDbm - rssi) / (10 * this.cfg.pathLossExponent);
        const distance = Math.pow(10, exponent);

        if (!Number.isFinite(distance)) return null;
        return Math.round(Math.min(distance, MAX_PLAUSIBLE_DISTANCE_M) * 100) / 100;
    }

    /**
     * Traduce a dB un factor de escala observado entre distancia estimada y
     * distancia geométrica.
     *
     * El posicionador estima ese factor por dispositivo sin usar el nivel de
     * referencia (ver `PositioningService`), así que su mediana dice cuánto se
     * desvía el modelo de la realidad del espacio. El resultado es **lo que hay
     * que restar a `RSSI_REFERENCE_DBM`** para que las distancias cuadren con la
     * geometría: positivo, el modelo exagera las distancias; negativo, las
     * acorta.
     *
     * @param factorEscala - Cuántas veces mayor es la distancia estimada que la real.
     * @returns Corrección en dB, o `null` si el factor no es utilizable.
     */
    desajusteDb(factorEscala: number): number | null {
        if (!Number.isFinite(factorEscala) || factorEscala <= 0) return null;
        return Math.round(10 * this.cfg.pathLossExponent * Math.log10(factorEscala) * 10) / 10;
    }

    /**
     * Traduce un error de señal en dB al error que produce en el logaritmo
     * natural de la distancia, que es la unidad en la que trabaja el
     * posicionador. Depende del exponente: con n = 2, 4 dB son un 58 % de
     * distancia; con n = 3, un 36 %.
     *
     * @param db - Error de señal, en dB.
     */
    aLogDistancia(db: number): number {
        return (db * Math.LN10) / (10 * this.cfg.pathLossExponent);
    }
}
