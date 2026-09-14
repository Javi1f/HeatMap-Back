import { injectable } from 'tsyringe';
import { DatabaseConfig } from '../../../config/database.config';
import type { MotivoInfraestructura } from '../services/presencia';

/** Dispositivo clasificado, listo para registrar. */
export interface InfraestructuraInsert {
    /** HMAC-SHA256 de la MAC. */
    macHash: string;

    /** Regla que lo identificó. */
    motivo: MotivoInfraestructura;
}

/**
 * Acceso a los dispositivos clasificados como infraestructura.
 */
@injectable()
export class InfraestructuraRepository {
    constructor(private readonly db: DatabaseConfig) {}

    /**
     * Registra o renueva dispositivos clasificados.
     *
     * Una exclusión manual nunca se rebaja a automática: si la regla vuelve a
     * detectarlo, sólo se renueva la fecha. Se escribe en SQL porque el
     * `orUpdate` de TypeORM no expresa ninguna de las dos condiciones.
     *
     * @param filas   - Dispositivos a registrar.
     * @param momento - Momento de la detección.
     */
    async registrar(filas: readonly InfraestructuraInsert[], momento: Date): Promise<void> {
        if (filas.length === 0) return;

        const marcadores = filas.map(() => '(?, ?, ?, ?)').join(', ');
        const valores = filas.flatMap((fila) => [fila.macHash, fila.motivo, momento, momento]);

        await this.db.dataSource.query(
            `INSERT INTO dispositivo_infraestructura (mac_hash, motivo, primera_deteccion, ultima_deteccion)
             VALUES ${marcadores} AS nuevo
             ON DUPLICATE KEY UPDATE
                 motivo = IF(dispositivo_infraestructura.motivo = 'manual', 'manual', nuevo.motivo),
                 ultima_deteccion = GREATEST(dispositivo_infraestructura.ultima_deteccion, nuevo.ultima_deteccion)`,
            valores,
        );
    }

    /**
     * Hashes que hoy no cuentan como ocupantes.
     *
     * @param confirmadosDesde - Las marcas automáticas no confirmadas desde
     *                           entonces se consideran caducadas.
     */
    async vigentes(confirmadosDesde: Date): Promise<Set<string>> {
        const filas: { mac_hash: string }[] = await this.db.dataSource.query(
            `SELECT mac_hash FROM dispositivo_infraestructura
             WHERE motivo = 'manual' OR ultima_deteccion >= ?`,
            [confirmadosDesde],
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
