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
import { CapturaRepository } from '../persistencia/repositorios/captura.repository';
import { InfraestructuraRepository } from '../persistencia/repositorios/infraestructura.repository';
import { MacAnonymizerService } from '../modules/anonimizacion/mac-anonymizer.service';
import { evaluarPresencia } from '../modules/procesamiento/presencia';

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

/** Datos con los que se explica el veredicto de un dispositivo. */
export interface DatosVeredicto {
    /** `true` si el criterio de presencia lo cuenta. */
    presente: boolean;

    /** `true` si está marcado como infraestructura vigente. */
    excluido: boolean;

    /** Nodos que lo oyeron en la ventana. */
    oyentes: number;

    /** Nodos que el criterio exige que lo oigan. */
    exigidos: number;

    /** Señal en el nodo que mejor lo oye, en dBm. */
    mejor: number;

    /** Señal mínima exigida en el nodo que mejor lo oye, en dBm. */
    umbralMejor: number;

    /** Señal mínima exigida en el nodo que peor lo oye, en dBm. */
    umbral: number;
}

/** Explica por qué el sistema cuenta o descarta el dispositivo. */
export const veredicto = ({ presente, excluido, oyentes, exigidos, mejor, umbralMejor, umbral }: DatosVeredicto): string => {
    if (presente) return 'PRESENTE';
    if (excluido) return 'EXCLUIDO como infraestructura';
    if (oyentes < exigidos) return `FUERA: sólo lo oyen ${oyentes} nodo(s) de los ${exigidos} exigidos`;
    if (mejor < umbralMejor) return `FUERA: ni el nodo que mejor lo oye llega a ${umbralMejor} dBm; está lejos de todos`;
    return `FUERA: el nodo más débil no llega a ${umbral} dBm`;
};

/** Texto de la señal de un nodo, o una raya si no lo oyó. */
const columna = (nodo: string, rssi: number | undefined): string =>
    `${nodo} ${rssi === undefined ? '  —' : Math.round(rssi).toString().padStart(4)}`;

/** Realiza una medición y la imprime. */
export const medir = async (macHash: string): Promise<void> => {
    const capturas = container.resolve(CapturaRepository);
    const infraestructura = container.resolve(InfraestructuraRepository);
    const cfg = container.resolve(SensingConfig);

    const hasta = new Date();
    const desde = new Date(hasta.getTime() - VENTANA_MS);
    const [senales, excluidos] = await Promise.all([
        capturas.senalesPorNodo(desde, hasta),
        infraestructura.vigentes(
            new Date(hasta.getTime() - cfg.infraestructuraVigenciaHoras * 3_600_000),
            cfg.infraestructuraPermanenciaMinutos * 60,
        ),
    ]);

    const propias = senales.filter((senal) => senal.macHash === macHash);
    if (propias.length === 0) {
        escribir(`${hora()}  ningún nodo lo ha oído en los últimos ${VENTANA_MS / 1000} s`);
        return;
    }

    const deLaZona = senales.filter((senal) => senal.idZona === propias[0].idZona);
    const nodos = [...new Set(deLaZona.map((senal) => senal.idSensor))].sort();
    const porNodo = new Map(propias.map((senal) => [senal.idSensor, senal.rssi]));

    const columnas = nodos.map((nodo) => columna(nodo, porNodo.get(nodo))).join('   ');

    const criterios = {
        rssiMinimoDbm: cfg.presenciaRssiMinimoDbm,
        nodosMinimos: cfg.presenciaNodosMinimos,
        rssiMejorMinimoDbm: cfg.presenciaRssiMejorMinimoDbm,
        excluidos,
    };
    const presente = evaluarPresencia(deLaZona, criterios).presentes.has(macHash);
    const senalesPropias = propias.map((senal) => senal.rssi);
    const masDebil = Math.round(Math.min(...senalesPropias));
    const texto = veredicto({
        presente,
        excluido: excluidos.has(macHash),
        oyentes: porNodo.size,
        exigidos: Math.min(cfg.presenciaNodosMinimos, nodos.length),
        mejor: Math.max(...senalesPropias),
        umbralMejor: cfg.presenciaRssiMejorMinimoDbm,
        umbral: cfg.presenciaRssiMinimoDbm,
    });

    escribir(`${hora()}  ${columnas}   | más débil ${masDebil} dBm | ${texto}`);
};

/**
 * Punto de entrada: valida la MAC y mide en bucle hasta recibir Ctrl+C.
 *
 * La parada va por un `AbortController` y no por una variable que cambia un
 * manejador de señal: así la condición del bucle refleja un estado que otro
 * código puede cambiar, en lugar de una variable que el bucle nunca toca.
 */
export const principal = async (): Promise<void> => {
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

    const parada = new AbortController();
    process.once('SIGINT', () => parada.abort());

    // Las mediciones son secuenciales a propósito: cada una espera a la anterior.
    while (!parada.signal.aborted) {
        await medir(macHash); // skipcq: JS-0032
        await new Promise((resolver) => { // skipcq: JS-0032
            setTimeout(resolver, PAUSA_MS);
        });
    }
    await db.dataSource.destroy();
};

if (require.main === module) {
    principal().catch((err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
