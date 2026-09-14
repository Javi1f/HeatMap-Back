/**
 * Muestra en vivo cómo oyen los nodos a un dispositivo concreto y si el sistema
 * lo cuenta como presente.
 *
 * Sirve para calibrar `PRESENCIA_RSSI_MINIMO_DBM`: se recorre el espacio con un
 * teléfono —centro, esquinas, bordes— y se anota el nodo más débil en cada
 * punto. El umbral tiene que quedar por debajo del peor valor medido dentro, y
 * repetir la prueba desde el piso de abajo dice cuánto ruido deja pasar.
 *
 * La MAC del teléfono está en sus ajustes de Wi-Fi. Si usa MAC aleatoria, es la
 * de la red a la que está conectado.
 *
 * Uso: `npm run dispositivo:medir -- AA:BB:CC:DD:EE:FF`
 */
import '../loadEnv';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { DatabaseConfig } from '../config/database.config';
import { SensingConfig } from '../config/sensing.config';
import { CapturaRepository } from '../modules/sensor/repositories/captura.repository';
import { InfraestructuraRepository } from '../modules/sensor/repositories/infraestructura.repository';
import { MacAnonymizerService } from '../modules/sensor/services/mac-anonymizer.service';
import { evaluarPresencia } from '../modules/sensor/services/presencia';

/** Ventana de cada medición: corta, para seguir a quien camina. */
const VENTANA_MS = 30_000;

/** Pausa entre mediciones. */
const PAUSA_MS = 5_000;

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Hora local en `HH:MM:SS`. */
const hora = (): string => new Date().toTimeString().slice(0, 8);

/** Realiza una medición y la imprime. */
const medir = async (macHash: string): Promise<void> => {
    const capturas = container.resolve(CapturaRepository);
    const infraestructura = container.resolve(InfraestructuraRepository);
    const cfg = container.resolve(SensingConfig);

    const hasta = new Date();
    const desde = new Date(hasta.getTime() - VENTANA_MS);
    const [senales, excluidos] = await Promise.all([
        capturas.senalesPorNodo(desde, hasta),
        infraestructura.vigentes(new Date(hasta.getTime() - cfg.infraestructuraVigenciaHoras * 3_600_000)),
    ]);

    const propias = senales.filter((senal) => senal.macHash === macHash);
    if (propias.length === 0) {
        escribir(`${hora()}  ningún nodo lo ha oído en los últimos ${VENTANA_MS / 1000} s`);
        return;
    }

    const deLaZona = senales.filter((senal) => senal.idZona === propias[0].idZona);
    const nodos = [...new Set(deLaZona.map((senal) => senal.idSensor))].sort();
    const porNodo = new Map(propias.map((senal) => [senal.idSensor, senal.rssi]));

    const columnas = nodos
        .map((nodo) => {
            const rssi = porNodo.get(nodo);
            return `${nodo} ${rssi === undefined ? '  —' : Math.round(rssi).toString().padStart(4)}`;
        })
        .join('   ');

    const resultado = evaluarPresencia(deLaZona, { rssiMinimoDbm: cfg.presenciaRssiMinimoDbm, excluidos });
    const masDebil = Math.round(Math.min(...propias.map((senal) => senal.rssi)));
    const sordos = nodos.filter((nodo) => !porNodo.has(nodo));

    let veredicto = `FUERA: el nodo más débil no llega a ${cfg.presenciaRssiMinimoDbm} dBm`;
    if (resultado.presentes.has(macHash)) veredicto = 'PRESENTE';
    else if (excluidos.has(macHash)) veredicto = 'EXCLUIDO como infraestructura';
    else if (sordos.length > 0) veredicto = `FUERA: no lo oye ${sordos.join(', ')}`;

    escribir(`${hora()}  ${columnas}   | más débil ${masDebil} dBm | ${veredicto}`);
};

const principal = async (): Promise<void> => {
    const mac = process.argv[2] ?? '';
    const anonimizador = container.resolve(MacAnonymizerService);
    if (mac.toLowerCase().replace(/[^0-9a-f]/g, '').length !== 12) {
        escribir('Uso: npm run dispositivo:medir -- AA:BB:CC:DD:EE:FF');
        process.exitCode = 1;
        return;
    }

    const db = container.resolve(DatabaseConfig);
    await db.initialize();
    const macHash = anonimizador.hash(mac);

    escribir(`Midiendo cada ${PAUSA_MS / 1000} s sobre los últimos ${VENTANA_MS / 1000} s. Ctrl+C para terminar.\n`);

    let activo = true;
    process.once('SIGINT', () => {
        activo = false;
    });

    while (activo) {
        await medir(macHash);
        await new Promise((resolver) => setTimeout(resolver, PAUSA_MS));
    }
    await db.dataSource.destroy();
};

principal().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
});
