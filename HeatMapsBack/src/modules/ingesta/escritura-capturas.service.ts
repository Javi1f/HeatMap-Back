import { singleton } from 'tsyringe';
import { LoggerService } from '../../common/logger/logger.service';
import { CapturaInsert, CapturaRepository } from '../../persistencia/repositorios/captura.repository';

/** Filas por sentencia INSERT. */
export const FILAS_POR_LOTE = 2_000;

/** Escrituras en curso a la vez, cada una por su conexión del pool. */
export const ESCRITURAS_SIMULTANEAS = 2;

/** Espera máxima de una fila en el búfer antes de escribirla, en milisegundos. */
export const ESPERA_MAXIMA_MS = 1_000;

/**
 * Filas que puede retener el búfer.
 *
 * Con los nodos produciendo unas 470 filas por segundo, son unos dos minutos de
 * capturas: margen para un corte breve de la base sin perder nada, y un techo
 * de memoria si el corte se alarga.
 */
export const CAPACIDAD_FILAS = 60_000;

/** Pausa antes de reintentar tras un fallo de escritura, en milisegundos. */
export const ESPERA_REINTENTO_MS = 5_000;

/** Intervalo mínimo entre dos avisos de filas descartadas por búfer lleno, en milisegundos. */
const AVISO_DESCARTES_MS = 60_000;

/**
 * Búfer entre la ingesta de Kafka y la tabla `captura`.
 *
 * **Por qué existe.** Cada lectura trae del orden de 500 detecciones y los
 * nodos publican unas 50 lecturas por minuto: unas 28 000 filas por minuto
 * contra una base remota, con 200–500 ms por ida y vuelta. Si el consumer de
 * Kafka espera a que cada lectura quede escrita antes de pedir la siguiente, su
 * ritmo lo marca la red: iba al límite de lo que la base admite, cualquier
 * consulta pesada lo retrasaba, y a partir de un minuto de retraso cada mensaje
 * llegaba caducado y se descartaba.
 *
 * Aquí la lectura de Kafka y la escritura en la base van por separado. El
 * consumer entrega las filas y sigue; este servicio las junta en sentencias de
 * hasta {@link FILAS_POR_LOTE} filas y mantiene {@link ESCRITURAS_SIMULTANEAS}
 * en curso. Medido contra la base real, una conexión escribe unas 700 filas
 * por segundo y dos, unas 1 260: más del doble de lo que llega.
 *
 * **Si la base no da abasto o se cae**, las filas esperan aquí, y los fallos se
 * reintentan. El búfer tiene techo ({@link CAPACIDAD_FILAS}): al llenarse se
 * descartan las filas **más antiguas**, con aviso, para que al recuperarse la
 * base el sistema siga en tiempo real en lugar de arrastrar minutos de atraso.
 *
 * **Lo que se pierde en un cierre abrupto** es lo que haya en el búfer, como
 * mucho un segundo en condiciones normales. En un cierre ordenado,
 * {@link terminar} escribe lo pendiente antes de soltar la conexión.
 */
@singleton()
export class EscrituraCapturasService {
    /** Filas pendientes, de la más antigua a la más reciente. */
    private pendientes: CapturaInsert[] = [];

    /** Escrituras en curso. */
    private enCurso = 0;

    /** Temporizador de la próxima escritura por tiempo, o `null` si no hay ninguna programada. */
    private temporizador: ReturnType<typeof setTimeout> | null = null;

    /** Momento hasta el que no se reintenta tras un fallo, en milisegundos. */
    private pausadoHasta = 0;

    /** Filas descartadas por búfer lleno desde el último aviso. */
    private descartadas = { cantidad: 0, ultimoAviso: 0 };

    /** Promesa de cada escritura en curso, para esperarlas al terminar. */
    private readonly escrituras = new Set<Promise<unknown>>();

    constructor(
        private readonly capturas: CapturaRepository,
        private readonly logger: LoggerService,
    ) {}

    /** Filas que esperan a escribirse. */
    get filasPendientes(): number {
        return this.pendientes.length;
    }

    /**
     * Añade filas al búfer y vuelve enseguida: la escritura ocurre aparte.
     *
     * @param filas - Detecciones ya anonimizadas.
     */
    encolar(filas: readonly CapturaInsert[]): void {
        if (filas.length === 0) return;
        this.pendientes.push(...filas);
        // Primero se reparte lo que ya puede salir; el techo se aplica a lo que queda esperando.
        this.escribir();
        this.recortar();
    }

    /**
     * Escribe todo lo pendiente y espera a que terminen las escrituras en curso.
     *
     * @param limiteMs - Tiempo máximo de espera; lo que quede después se pierde.
     */
    async terminar(limiteMs = 10_000): Promise<void> {
        const fin = Date.now() + limiteMs;
        this.pausadoHasta = 0;
        while ((this.pendientes.length > 0 || this.enCurso > 0) && Date.now() < fin) {
            this.escribir(true);
            // skipcq: JS-0032 — hay que esperar a que acabe una escritura para lanzar la siguiente
            await Promise.race([
                ...this.escrituras,
                new Promise((resolve) => {
                    setTimeout(resolve, 100);
                }),
            ]);
        }
        this.cancelarTemporizador();
        if (this.pendientes.length > 0) {
            this.logger.warn(`${this.pendientes.length} capturas sin escribir al cerrar`);
        }
    }

    /** Descarta las filas más antiguas que no caben. */
    private recortar(): void {
        const sobrantes = this.pendientes.length - CAPACIDAD_FILAS;
        if (sobrantes <= 0) return;

        this.pendientes.splice(0, sobrantes);
        this.descartadas.cantidad += sobrantes;
        const ahora = Date.now();
        if (ahora - this.descartadas.ultimoAviso < AVISO_DESCARTES_MS) return;
        this.logger.warn(
            `${this.descartadas.cantidad} capturas descartadas: la base no da abasto y el búfer `
            + `llegó a ${CAPACIDAD_FILAS} filas. Se conservan las más recientes.`,
        );
        this.descartadas = { cantidad: 0, ultimoAviso: ahora };
    }

    /**
     * Lanza escrituras mientras haya hueco y filas que escribir.
     *
     * Un lote incompleto espera hasta {@link ESPERA_MAXIMA_MS} a llenarse, salvo
     * que se fuerce (al terminar).
     *
     * @param forzar - Escribe aunque el lote no esté lleno.
     */
    private escribir(forzar = false): void {
        const espera = this.pausadoHasta - Date.now();
        if (espera > 0) {
            this.programar(espera);
            return;
        }
        while (this.enCurso < ESCRITURAS_SIMULTANEAS && this.pendientes.length >= FILAS_POR_LOTE) {
            this.lanzar(this.pendientes.splice(0, FILAS_POR_LOTE));
        }
        if (this.pendientes.length === 0) return;
        if (forzar && this.enCurso < ESCRITURAS_SIMULTANEAS) {
            this.cancelarTemporizador();
            this.lanzar(this.pendientes.splice(0, FILAS_POR_LOTE));
            return;
        }
        this.programar(ESPERA_MAXIMA_MS);
    }

    /** Programa una escritura por tiempo, si no hay ya una. */
    private programar(ms: number): void {
        if (this.temporizador) return;
        this.temporizador = setTimeout(() => {
            this.temporizador = null;
            this.escribir(true);
        }, ms);
    }

    /** Anula la escritura programada. */
    private cancelarTemporizador(): void {
        if (!this.temporizador) return;
        clearTimeout(this.temporizador);
        this.temporizador = null;
    }

    /**
     * Escribe un lote. Si falla, lo devuelve al principio del búfer y pausa
     * los reintentos: la causa más probable es que la base no responda.
     */
    private lanzar(lote: CapturaInsert[]): void {
        this.enCurso++;
        const escritura = this.capturas.insertMany(lote)
            .catch((err: unknown) => {
                this.logger.error(`No se pudieron guardar ${lote.length} capturas; se reintentará`, err);
                this.pendientes.unshift(...lote);
                this.recortar();
                this.pausadoHasta = Date.now() + ESPERA_REINTENTO_MS;
            })
            .finally(() => {
                this.enCurso--;
                this.escrituras.delete(escritura);
                if (this.pendientes.length > 0) this.escribir();
            });
        this.escrituras.add(escritura);
    }
}
