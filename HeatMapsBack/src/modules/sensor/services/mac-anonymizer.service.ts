import crypto from 'crypto';
import { singleton } from 'tsyringe';
import { SensingConfig } from '../../../config/sensing.config';

/** Una EUI-48 son 12 dígitos hexadecimales. */
const MAC_HEX_LENGTH = 12;

/**
 * Reduce una MAC a sus dígitos hexadecimales en minúscula, de forma que
 * `AA:BB:...`, `aa-bb-...` y `aabb...` se traten como la misma dirección.
 */
const normalize = (mac: string): string => mac.toLowerCase().replace(/[^0-9a-f]/g, '');

/**
 * Anonimización de direcciones MAC.
 *
 * **Por qué HMAC y no SHA-256 a secas**: el espacio de direcciones MAC es de
 * 2^48 y los tres primeros octetos (OUI) son un catálogo público. Un hash sin
 * clave es reversible por fuerza bruta en minutos con hardware corriente, así
 * que no constituye anonimización frente a ningún criterio serio. El HMAC con
 * una clave que nunca sale del servidor hace inviable ese ataque salvo que se
 * filtre la clave.
 *
 * **Dónde debería ejecutarse esto**: en el nodo de captura, antes de publicar
 * a Kafka. Hoy el productor envía la MAC en claro y este servicio la anonimiza
 * al ingresar, lo que protege la base de datos pero no el tránsito. Mover el
 * HMAC al borde exige compartir la clave con los nodos y es trabajo pendiente
 * del lado del productor en Python.
 */
@singleton()
export class MacAnonymizerService {
    constructor(private readonly cfg: SensingConfig) {}

    /**
     * Calcula el identificador anónimo y estable de una MAC.
     *
     * Normaliza a minúsculas y sin separadores para que `AA:BB:...` y
     * `aa-bb-...` produzcan el mismo hash.
     *
     * @returns HMAC-SHA256 en hex (64 caracteres).
     */
    hash(mac: string): string {
        const normalized = normalize(mac);
        return crypto
            .createHmac('sha256', this.cfg.macHashKey)
            .update(normalized)
            .digest('hex');
    }

    /**
     * Determina si una MAC es administrada localmente, es decir, generada por
     * el propio dispositivo en lugar de asignada por el fabricante.
     *
     * Según IEEE 802 para EUI-48, el segundo bit menos significativo del primer
     * octeto es el bit U/L: 0 = universal (fabricante), 1 = local (aleatoria).
     *
     * Una entrada que no reduzca a 48 bits exactos se rechaza en lugar de
     * interpretarse: filtrar los dígitos hexadecimales de una cadena arbitraria
     * deja residuos que parsean sin error y producirían un veredicto inventado.
     *
     * @param mac - Dirección en cualquier formato de separadores.
     * @returns `true` si la dirección parece aleatorizada.
     */
    isRandomized(mac: string): boolean {
        const normalized = normalize(mac);
        if (normalized.length !== MAC_HEX_LENGTH) return false;

        const firstOctet = parseInt(normalized.slice(0, 2), 16);
        if (Number.isNaN(firstOctet)) return false;
        return (firstOctet & 0b10) !== 0;
    }
}
