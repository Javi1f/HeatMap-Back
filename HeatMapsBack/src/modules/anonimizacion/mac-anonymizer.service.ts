import crypto from 'crypto';
import { singleton } from 'tsyringe';
import { SensingConfig } from '../../config/sensing.config';
import { esMacAleatoria, normalizarMac } from '../../common/utils/mac';

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
 * **Dónde se ejecuta**: en el back-end, como módulo propio entre la ingesta y
 * el procesamiento, tal como lo sitúa el diagrama de arquitectura (Anexo 9).
 * Así la clave HMAC nunca sale del servidor. El tránsito desde el nodo va
 * protegido por el cifrado del payload y por TLS hacia el bróker (RNF-12), y
 * la MAC en claro no llega a la base de datos ni a ningún cliente (RF-02).
 *
 * La forma canónica de la MAC y la regla de aleatorización son las de
 * `common/utils/mac`, las mismas que usa el filtrado: si difirieran, un mismo
 * dispositivo daría dos hashes distintos.
 */
@singleton()
export class MacAnonymizerService {
    /** `true` si la dirección es administrada localmente (bit U/L), como las aleatorizadas. */
    readonly isRandomized = esMacAleatoria;

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
        return crypto
            .createHmac('sha256', this.cfg.macHashKey)
            .update(normalizarMac(mac))
            .digest('hex');
    }
}
