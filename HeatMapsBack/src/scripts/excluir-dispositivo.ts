/**
 * Excluye a mano un dispositivo del conteo de presencia, o deshace la exclusión.
 *
 * Es para la infraestructura que las reglas automáticas no reconocen: un
 * router de una sola red que no está pegado a ningún nodo, o un equipo fijo que
 * no debe contar como ocupante. La exclusión manual no caduca.
 *
 * Se guarda sólo el HMAC de la MAC, igual que en las capturas.
 *
 * Uso:
 *   `npm run dispositivo:excluir -- AA:BB:CC:DD:EE:FF`
 *   `npm run dispositivo:excluir -- AA:BB:CC:DD:EE:FF --quitar`
 */
import '../loadEnv';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { DatabaseConfig } from '../config/database.config';
import { InfraestructuraRepository } from '../modules/sensor/repositories/infraestructura.repository';
import { MacAnonymizerService } from '../modules/sensor/services/mac-anonymizer.service';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Indica si el texto contiene exactamente los 12 dígitos de una MAC. */
const esMac = (texto: string): boolean => texto.toLowerCase().replace(/[^0-9a-f]/g, '').length === 12;

/**
 * Registra o elimina la exclusión y comunica el resultado.
 *
 * @param mac    - Dirección del dispositivo, en claro.
 * @param quitar - `true` para deshacer la exclusión.
 */
const aplicar = async (mac: string, quitar: boolean): Promise<void> => {
    const repositorio = container.resolve(InfraestructuraRepository);
    const macHash = container.resolve(MacAnonymizerService).hash(mac);

    if (!quitar) {
        await repositorio.registrar([{ macHash, motivo: 'manual' }], new Date());
        escribir('Dispositivo excluido: deja de contar en el mapa, la ocupación y el panel.');
        return;
    }

    const habia = await repositorio.eliminar(macHash);
    escribir(habia ? 'Exclusión eliminada: vuelve a contar si está presente.' : 'Ese dispositivo no estaba excluido.');
};

/** Punto de entrada: valida los argumentos y aplica la exclusión con la base abierta. */
const principal = async (): Promise<void> => {
    const [mac = '', opcion] = process.argv.slice(2);
    const opcionValida = opcion === undefined || opcion === '--quitar';
    if (!esMac(mac) || !opcionValida) {
        escribir('Uso: npm run dispositivo:excluir -- AA:BB:CC:DD:EE:FF [--quitar]');
        process.exitCode = 1;
        return;
    }

    const db = container.resolve(DatabaseConfig);
    await db.initialize();
    try {
        await aplicar(mac, opcion === '--quitar');
    } finally {
        await db.dataSource.destroy();
    }
};

principal().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
