import { injectable } from 'tsyringe';
import { DatabaseConfig } from '../../config/database.config';
import type { MotivoInfraestructura } from '../entidades/DispositivoInfraestructura.entity';

/** Dispositivo clasificado, listo para registrar. */
export interface InfraestructuraInsert {
    /** HMAC-SHA256 de la MAC. */
    macHash: string;

    /** Regla que lo identificó. */
    motivo: MotivoInfraestructura;
}

/**
 * Pausa sin reconfirmar tras la que una racha se da por cortada, por defecto.
 *
 * Quien registra renueva cada marca como mucho cada 10 minutos, así que en una
 * presencia continuada las confirmaciones llegan separadas unos 10 minutos.
 * El doble deja margen para una lectura perdida sin confundir con la misma
 * racha dos visitas separadas por un rato.
 */
const REINICIO_RACHA_POR_DEFECTO_MS = 20 * 60_000;

/**
 * Acceso a los dispositivos clasificados como infraestructura.
 *
 * **Qué guarda `primera_deteccion`**: el inicio de la racha actual de
 * confirmaciones, no la primera vez que se vio el dispositivo. Si pasa más de
 * la pausa admitida sin reconfirmarse, la siguiente confirmación la reinicia.
 * Con eso, `ultima_deteccion − primera_deteccion` mide cuánto tiempo lleva el
 * dispositivo **seguido** cumpliendo la regla, que es lo que separa el
 * equipamiento del despliegue de alguien que pasó junto a un nodo.
 */
@injectable()
export class InfraestructuraRepository {
    constructor(private readonly db: DatabaseConfig) {}

    /**
     * Registra o renueva dispositivos clasificados.
     *
     * Una exclusión manual nunca se rebaja a automática: si la regla vuelve a
     * detectarlo, sólo se renueva la fecha. Se escribe en SQL porque el
     * `orUpdate` de TypeORM no expresa ninguna de las condiciones.
     *
     * El orden de las asignaciones importa: MySQL las evalúa de izquierda a
     * derecha y cada una ve ya actualizadas las anteriores. `primera_deteccion`
     * va primero para compararse con la `ultima_deteccion` **anterior**.
     *
     * @param filas           - Dispositivos a registrar.
     * @param momento         - Momento de la detección.
     * @param reinicioRachaMs - Pausa sin reconfirmar tras la que empieza una racha nueva.
     */
    async registrar(
        filas: readonly InfraestructuraInsert[],
        momento: Date,
        reinicioRachaMs = REINICIO_RACHA_POR_DEFECTO_MS,
    ): Promise<void> {
        if (filas.length === 0) return;

        const marcadores = filas.map(() => '(?, ?, ?, ?)').join(', ');
        const valores = filas.flatMap((fila) => [fila.macHash, fila.motivo, momento, momento]);

        await this.db.dataSource.query(
            `INSERT INTO dispositivo_infraestructura (mac_hash, motivo, primera_deteccion, ultima_deteccion)
             VALUES ${marcadores} AS nuevo
             ON DUPLICATE KEY UPDATE
                 primera_deteccion = IF(
                     dispositivo_infraestructura.ultima_deteccion < nuevo.ultima_deteccion - INTERVAL ? SECOND,
                     nuevo.primera_deteccion,
                     dispositivo_infraestructura.primera_deteccion),
                 motivo = IF(dispositivo_infraestructura.motivo = 'manual', 'manual', nuevo.motivo),
                 ultima_deteccion = GREATEST(dispositivo_infraestructura.ultima_deteccion, nuevo.ultima_deteccion)`,
            [...valores, Math.round(reinicioRachaMs / 1000)],
        );
    }

    /**
     * Hashes que hoy no cuentan como ocupantes.
     *
     * Las exclusiones manuales valen siempre. Las automáticas, mientras se
     * sigan confirmando; y las de `junto-a-nodo` además sólo si llevan una
     * racha seguida de al menos `permanenciaMinimaS`: una sola lectura fuerte
     * es alguien que pasó al lado, no el equipamiento del nodo.
     *
     * @param confirmadosDesde   - Las marcas automáticas no confirmadas desde
     *                             entonces se consideran caducadas.
     * @param permanenciaMinimaS - Racha mínima, en segundos, que necesita una
     *                             marca `junto-a-nodo` para excluir.
     */
    async vigentes(confirmadosDesde: Date, permanenciaMinimaS: number): Promise<Set<string>> {
        const filas: { mac_hash: string }[] = await this.db.dataSource.query(
            `SELECT mac_hash FROM dispositivo_infraestructura
             WHERE motivo = 'manual'
                OR (ultima_deteccion >= ?
                    AND (motivo <> 'junto-a-nodo'
                         OR TIMESTAMPDIFF(SECOND, primera_deteccion, ultima_deteccion) >= ?))`,
            [confirmadosDesde, permanenciaMinimaS],
        );
        return new Set(filas.map((fila) => fila.mac_hash));
    }

    /** Elimina una exclusión, sea cual sea su motivo. */
    async eliminar(macHash: string): Promise<boolean> {
        const resultado: { affectedRows?: number } = await this.db.dataSource.query(
            'DELETE FROM dispositivo_infraestructura WHERE mac_hash = ?',
            [macHash],
        );
        return (resultado.affectedRows ?? 0) > 0;
    }
}
