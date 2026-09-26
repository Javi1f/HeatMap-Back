import { singleton } from 'tsyringe';
import { Admin, Consumer, ConsumerCrashEvent, ConsumerGroupJoinEvent, EachMessagePayload, Kafka } from 'kafkajs';
import { KafkaConfig } from '../../config/kafka.config';
import { SensorPayloadCipher } from '../../crypto/sensor-payload.crypto';
import { LoggerService } from '../../common/logger/logger.service';
import { LecturaSensor, ResumenSensor } from '../../types/sensor.types';
import { MESSAGES } from '../../constants/messages';
import { DataProcessorService } from './data-processor.service';
import { validarLectura } from './validacion-lectura';
import { SocketEmitterService } from '../tiempo-real/socket-emitter.service';

/**
 * Resumen de una lectura procesada, para difundirlo a tiempo real.
 *
 * @param lectura    - Lectura validada.
 * @param guardados  - Dispositivos que pasaron el filtrado y se guardaron.
 */
const resumenDe = (lectura: LecturaSensor, guardados: number): ResumenSensor => ({
    total_devices: guardados,
    timestamp: new Date(lectura.timestamp * 1000).toLocaleTimeString('es-ES'),
    received_at: new Date().toISOString(),
});

/** Primera espera antes de reintentar tras una caída del consumer, en milisegundos. */
const ESPERA_INICIAL_MS = 5_000;

/** Tope de la espera entre reintentos, en milisegundos. */
const ESPERA_MAXIMA_MS = 60_000;

/** Intervalo mínimo entre dos avisos de mensajes descartados por antiguos, en milisegundos. */
const AVISO_DESCARTES_MS = 60_000;

/**
 * Descartes seguidos tras los que el consumer se adelanta a la cabeza del topic.
 *
 * Con los nodos publicando unas 40 lecturas por minuto, cincuenta descartes
 * seguidos son más de un minuto sin guardar nada: ya no es un mensaje rezagado
 * suelto, es una cola que quedó por detrás del límite de antigüedad. El número
 * es holgado a propósito, para no saltar por un tropiezo momentáneo del
 * productor o del broker.
 */
const DESCARTES_SEGUIDOS_PARA_ADELANTAR = 50;

/** Tipo de error de Kafka cuando los miembros de un grupo no comparten asignador. */
const PROTOCOLO_INCOMPATIBLE = 'INCONSISTENT_GROUP_PROTOCOL';

/** Error de kafkajs con los campos opcionales que usa para encadenar causas. */
type ErrorKafka = Error & { cause?: Error; type?: string };

/**
 * Error que originó una caída.
 *
 * kafkajs envuelve el error del protocolo en varias capas, y el tipo que
 * explica la caída —como `INCONSISTENT_GROUP_PROTOCOL`— sólo está en la más
 * interna.
 */
const causaOriginal = (error: Error): ErrorKafka => {
    let actual: ErrorKafka = error;
    while (actual.cause) actual = actual.cause;
    return actual;
};

/** Desplazamiento de una partición en una respuesta de kafkajs, o −1 si no figura. */
const desplazamientoDe = (lista: readonly { partition: number; offset: string }[], particion: number): number =>
    Number(lista.find((candidata) => candidata.partition === particion)?.offset ?? -1);

/** Salto de una partición desde lo que el grupo confirmó hasta su primer mensaje vigente. */
interface Salto {
    /** Partición del topic. */
    particion: number;

    /** Desplazamiento confirmado por el grupo. */
    desde: number;

    /** Primer desplazamiento con un mensaje dentro del límite de antigüedad. */
    hasta: number;
}

/**
 * Saltos que dejan cada partición asignada en su primer mensaje vigente.
 *
 * Sólo hacia delante: si el grupo ya va por delante de ese punto, retroceder
 * volvería a guardar capturas ya guardadas. Una partición sin desplazamiento
 * confirmado tampoco se toca, porque el consumer empieza entonces por la cabeza
 * (`fromBeginning: false`) y no arrastra cola.
 */
const saltosHastaLoVigente = (
    particiones: readonly number[],
    confirmados: readonly { partition: number; offset: string }[],
    vigentes: readonly { partition: number; offset: string }[],
): Salto[] => particiones.flatMap((particion) => {
    const desde = desplazamientoDe(confirmados, particion);
    const hasta = desplazamientoDe(vigentes, particion);
    return desde >= 0 && hasta > desde ? [{ particion, desde, hasta }] : [];
});

/**
 * Consumidor del topic de Kafka donde los sensores publican lecturas WiFi.
 *
 * Responsabilidades:
 *  1. Suscribirse al topic configurado y consumir en streaming.
 *  2. Al unirse al grupo —en cada arranque—, saltar la parte de la cola que ya
 *     es más vieja que `maxMessageAgeSeconds`. Durante el consumo, descartar
 *     los mensajes caducados y, si son tantos seguidos que la cola entera ya
 *     caducó, adelantarse a la cabeza del topic en lugar de arrastrarse por
 *     detrás de ella.
 *  3. Descifrar cada payload (delegando en {@link SensorPayloadCipher}).
 *  4. Validar su estructura (`validarLectura`, etapa «Valida estructura» del
 *     diagrama de secuencia) y descartar la que no la cumpla.
 *  5. Delegar filtrado, anonimización y persistencia a {@link DataProcessorService}.
 *     Ese paso no espera a la base —las capturas van a un búfer de escritura—,
 *     así que el consumer lee al ritmo de Kafka aunque la red hasta la base sea
 *     lenta, y un mensaje sólo caduca si el backend estuvo parado.
 *  6. Difundir el resumen a clientes WebSocket vía {@link SocketEmitterService}.
 *
 * NO contiene lógica de negocio sobre los datos en sí — solo orquesta el
 * pipeline ingreso → proceso → notificación.
 *
 * Alcance único: la conexión y el estado `isRunning` describen un proceso, no
 * una petición. Con alcance transitorio, el controlador que responde a
 * `/kafka/status` consultaría una instancia distinta de la que consume, e
 * informaría siempre de que está detenida.
 *
 * **Caídas**: kafkajs sólo se reinicia solo ante errores recuperables. Ante uno
 * que no lo es —el broker rechaza al consumer porque otro cliente del grupo
 * negoció un asignador distinto— se desconecta y no vuelve a intentarlo, y el
 * servidor HTTP sigue respondiendo como si nada. Por eso el servicio escucha
 * la caída, la registra con su causa y reintenta con espera creciente.
 */
@singleton()
export class KafkaConsumerService {
    /** Cliente de KafkaJS. Se crea una sola vez y se reutiliza. */
    private kafka: Kafka | null = null;

    /** Consumidor activo, o `null` mientras esta detenido. */
    private consumer: Consumer | null = null;

    /** Estado interno que hace idempotentes a `start` y `stop`. */
    private isRunning = false;

    /** Temporizador del próximo reintento, o `null` si no hay ninguno pendiente. */
    private reintento: ReturnType<typeof setTimeout> | null = null;

    /** Espera del próximo reintento; se duplica con cada fallo seguido. */
    private esperaMs = ESPERA_INICIAL_MS;

    /** Descartes por antigüedad acumulados desde el último aviso. */
    private descartes = { cantidad: 0, mayorEdadS: 0, ultimoAviso: 0 };

    /** Descartes por antigüedad seguidos, sin ningún mensaje aprovechable entre ellos. */
    private descartesSeguidos = 0;

    /** `true` mientras se consulta la cabeza del topic para adelantarse a ella. */
    private adelantando = false;

    /** Identificador del cliente ante el broker, visible en sus metricas. */
    private static readonly CLIENT_ID = 'sensor-consumer';

    constructor(
        private readonly cfg: KafkaConfig,
        private readonly cipher: SensorPayloadCipher,
        private readonly processor: DataProcessorService,
        private readonly emitter: SocketEmitterService,
        private readonly logger: LoggerService,
    ) {}

    /** @returns true si el consumer está conectado y consumiendo. */
    get running(): boolean {
        return this.isRunning;
    }

    /**
     * Cliente de kafkajs, creado la primera vez que se necesita y reutilizado
     * después.
     *
     * Va en un accesor y no en el arranque para que el resto del servicio pueda
     * contar con que existe: un campo que puede ser nulo obligaría a comprobarlo
     * en cada uso, con una rama que nunca se cumple.
     */
    private get cliente(): Kafka {
        this.kafka ??= new Kafka({
            clientId: KafkaConsumerService.CLIENT_ID,
            brokers: this.cfg.brokers,
            ssl: this.cfg.ssl,
        });
        return this.kafka;
    }

    /**
     * Inicia el consumidor. Idempotente: si ya corre, no hace nada.
     *
     * @throws Cualquier error de conexión a Kafka.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            this.logger.warn(MESSAGES.CONSUMER.ALREADY_RUNNING);
            return;
        }

        const consumer = this.cliente.consumer({ groupId: this.cfg.groupId });
        this.consumer = consumer;
        consumer.on(consumer.events.GROUP_JOIN, (evento) => this.alUnirseAlGrupo(consumer, evento));
        consumer.on(consumer.events.CRASH, (evento) => this.alCaer(consumer, evento));
        await consumer.connect();
        await consumer.subscribe({ topic: this.cfg.topic, fromBeginning: false });
        await consumer.run({
            eachMessage: (payload: EachMessagePayload) => this.handleMessage(payload),
        });

        // La primera unión al grupo ocurre dentro de `run`. Si fracasó sin
        // remedio, `alCaer` ya descartó este consumer y programó el reintento:
        // marcarlo ahora como activo taparía la caída y bloquearía el reintento.
        if (this.consumer !== consumer) return;

        this.isRunning = true;
        this.logger.info(MESSAGES.CONSUMER.STARTED);
    }

    /**
     * Detiene el consumidor y escribe las capturas que queden en el búfer.
     * Idempotente.
     */
    async stop(): Promise<void> {
        if (this.reintento) {
            clearTimeout(this.reintento);
            this.reintento = null;
        }
        if (!this.isRunning || !this.consumer) {
            this.logger.warn(MESSAGES.CONSUMER.NOT_RUNNING);
            return;
        }
        await this.consumer.disconnect();
        this.consumer = null;
        this.isRunning = false;
        await this.processor.terminar();
        this.logger.info(MESSAGES.CONSUMER.STOPPED);
    }

    /**
     * Registra a qué particiones quedó asignado el consumer y salta lo que la
     * cola arrastre ya caducado.
     *
     * Unirse sin particiones no es un error: significa que otra instancia del
     * mismo grupo las está leyendo. Se avisa porque, visto desde fuera, es
     * indistinguible de un backend que no recibe nada.
     */
    private alUnirseAlGrupo(consumer: Consumer, { payload }: ConsumerGroupJoinEvent): void {
        this.esperaMs = ESPERA_INICIAL_MS;
        const particiones = payload.memberAssignment[this.cfg.topic] ?? [];

        if (particiones.length === 0) {
            this.logger.warn(`${MESSAGES.CONSUMER.NO_PARTITIONS} (${payload.groupId})`);
            return;
        }
        this.logger.info(
            `${MESSAGES.CONSUMER.GROUP_JOINED} ${payload.groupId}, particiones [${particiones.join(', ')}]`,
        );
        void this.saltarLoCaducado(consumer, particiones);
    }

    /**
     * Lleva cada partición asignada a su primer mensaje dentro del límite de
     * antigüedad.
     *
     * Con el backend parado, los nodos siguen publicando y el grupo se queda
     * atrás. Al volver, todo lo que había en medio es más viejo que el límite y
     * se iba a descartar mensaje a mensaje; mientras tanto no se guardaba nada y
     * los nodos aparecían caídos. Saltarlo al unirse hace que el arranque
     * empiece ya en tiempo real, sin tener que adelantar el grupo a mano.
     *
     * Se salta hasta el primer mensaje vigente y no hasta la cabeza, para no
     * perder las lecturas que se publicaron mientras el backend arrancaba. Un
     * fallo sólo se registra: el consumer sigue, y si la cola resulta estar
     * caducada se adelanta por su cuenta (ver `adelantarSiLaColaYaNoSirve`).
     */
    private async saltarLoCaducado(consumer: Consumer, particiones: readonly number[]): Promise<void> {
        const { topic, groupId, maxMessageAgeSeconds } = this.cfg;
        try {
            const [vigentes, confirmados] = await this.conAdmin((admin) => Promise.all([
                admin.fetchTopicOffsetsByTimestamp(topic, Date.now() - maxMessageAgeSeconds * 1000),
                admin.fetchOffsets({ groupId, topics: [topic] }),
            ]));
            const saltos = saltosHastaLoVigente(particiones, confirmados[0]?.partitions ?? [], vigentes);
            for (const { particion, desde, hasta } of saltos) {
                consumer.seek({ topic, partition: particion, offset: String(hasta) });
                this.logger.warn(`${hasta - desde} ${MESSAGES.KAFKA.STALE_SKIPPED_ON_JOIN} (partición ${particion})`);
            }
        } catch (err) {
            this.logger.error(MESSAGES.KAFKA.SEEK_ERROR, err);
        }
    }

    /**
     * Registra una caída y, si kafkajs no va a reiniciarse solo, programa el
     * reintento.
     *
     * Se ignoran las caídas de un consumer que ya no es el vigente: sin esa
     * comprobación, un evento tardío de un intento anterior descartaría al
     * consumer que sí funciona.
     */
    private alCaer(consumer: Consumer, { payload }: ConsumerCrashEvent): void {
        if (consumer !== this.consumer) return;

        const causa = causaOriginal(payload.error);
        const pista = causa.type === PROTOCOLO_INCOMPATIBLE ? ` ${MESSAGES.CONSUMER.INCOMPATIBLE_GROUP}` : '';
        this.logger.error(`${MESSAGES.CONSUMER.CRASHED} (${payload.groupId}): ${causa.message}.${pista}`);

        if (payload.restart) return;

        this.isRunning = false;
        this.consumer = null;
        this.programarReintento();
    }

    /**
     * Vuelve a iniciar el consumer tras una espera que se duplica con cada
     * fallo seguido, hasta {@link ESPERA_MAXIMA_MS}.
     *
     * La espera creciente evita martillear al broker cuando la causa es
     * persistente, como un grupo compartido con un cliente incompatible, sin
     * renunciar a recuperarse sola cuando la causa desaparece.
     */
    private programarReintento(): void {
        if (this.reintento) return;

        const espera = this.esperaMs;
        this.esperaMs = Math.min(this.esperaMs * 2, ESPERA_MAXIMA_MS);
        this.logger.warn(`${MESSAGES.CONSUMER.RESTARTING} ${Math.round(espera / 1000)} s`);

        this.reintento = setTimeout(() => {
            this.reintento = null;
            this.start().catch((err: unknown) => {
                this.logger.error(MESSAGES.CONSUMER.START_ERROR, err);
                this.programarReintento();
            });
        }, espera);
    }

    /**
     * Maneja un mensaje individual. Captura todos los errores aquí para no
     * derribar el consumer si un mensaje viene corrupto.
     */
    private async handleMessage({ topic, partition, message }: EachMessagePayload): Promise<void> {
        const lectura = this.leer(message.value);
        if (!lectura) return;

        if (this.isStale(lectura.timestamp)) {
            await this.adelantarSiLaColaYaNoSirve(topic, partition, message.offset);
            return;
        }
        this.descartesSeguidos = 0;
        await this.procesar(lectura);
    }

    /**
     * Descifra y valida un mensaje. Devuelve `null` si no trae una lectura
     * utilizable, después de dejar constancia del motivo.
     */
    private leer(valor: Buffer | null): LecturaSensor | null {
        if (!valor) {
            this.logger.warn(MESSAGES.KAFKA.EMPTY_MESSAGE);
            return null;
        }

        let contenido: unknown;
        try {
            contenido = this.cipher.decrypt(valor);
        } catch (err) {
            this.logger.error(MESSAGES.KAFKA.DECRYPT_ERROR, err);
            return null;
        }

        const validacion = validarLectura(contenido);
        if (!validacion.valida) {
            this.logger.warn(`${MESSAGES.KAFKA.INVALID_PAYLOAD}: ${validacion.motivo}`);
            return null;
        }
        if (validacion.descartados > 0) {
            this.logger.debug(`${validacion.descartados} ${MESSAGES.KAFKA.INVALID_DEVICES}`);
        }
        return validacion.lectura;
    }

    /**
     * Filtra, anonimiza y guarda una lectura válida, y difunde su resumen.
     * Un fallo aquí —la base caída, por ejemplo— se registra sin derribar el
     * consumer: la siguiente lectura se vuelve a intentar.
     */
    private async procesar(lectura: LecturaSensor): Promise<void> {
        try {
            const guardados = await this.processor.processAndSave(lectura);
            this.logger.info(
                `${MESSAGES.KAFKA.DATA_RECEIVED}: Sensor ${lectura.sensorId} | ${guardados} dispositivos`,
            );
            this.emitter.emitSensorData(resumenDe(lectura, guardados));
            this.logger.debug(MESSAGES.KAFKA.DATA_SENT);
        } catch (err) {
            this.logger.error(MESSAGES.KAFKA.PROCESS_ERROR, err);
        }
    }

    /**
     * Indica si el mensaje es más antiguo que el umbral configurado.
     *
     * Descartar lo antiguo es correcto al arrancar, cuando el grupo arrastra
     * lecturas viejas. Pero si el consumer no da abasto, cada mensaje llega ya
     * caducado, se descartan todos y no se guarda nada mientras el proceso
     * parece sano. Por eso se avisa, agrupado para no inundar el registro.
     *
     * @param timestamp - Momento de la lectura, en segundos desde epoch.
     * @returns true si el mensaje es más antiguo que el umbral configurado.
     */
    private isStale(timestamp: number): boolean {
        const age = Date.now() / 1000 - timestamp;
        if (age <= this.cfg.maxMessageAgeSeconds) return false;

        this.descartesSeguidos++;
        this.descartes.cantidad++;
        this.descartes.mayorEdadS = Math.max(this.descartes.mayorEdadS, age);

        const ahora = Date.now();
        if (ahora - this.descartes.ultimoAviso >= AVISO_DESCARTES_MS) {
            this.logger.warn(
                `${this.descartes.cantidad} ${MESSAGES.KAFKA.STALE_DISCARDED} `
                + `(límite ${this.cfg.maxMessageAgeSeconds} s, el más antiguo ${Math.round(this.descartes.mayorEdadS)} s)`,
            );
            this.descartes = { cantidad: 0, mayorEdadS: 0, ultimoAviso: ahora };
        }
        return true;
    }

    /**
     * Se adelanta a la cabeza del topic cuando la cola acumulada ya no sirve.
     *
     * Un consumer que se queda más atrás que el límite de antigüedad **no se
     * recupera solo**: acaba leyendo al mismo ritmo al que los nodos publican,
     * así que cada mensaje que saca de la cola nace ya caducado, lo descarta, y
     * el atraso se queda fijo indefinidamente. Mientras dura no se guarda
     * ninguna captura y los nodos aparecen caídos en el panel, aunque el proceso
     * esté sano y conectado.
     *
     * Saltar a la cabeza tira lo que de todas formas se iba a descartar y
     * devuelve el sistema a tiempo real en la siguiente lectura. Se registra
     * cuántos mensajes se omitieron, que es el tamaño real del atraso.
     */
    private async adelantarSiLaColaYaNoSirve(topic: string, partition: number, offset: string): Promise<void> {
        if (this.descartesSeguidos < DESCARTES_SEGUIDOS_PARA_ADELANTAR || this.adelantando) return;

        const consumer = this.consumer;
        if (!consumer) return;

        this.adelantando = true;
        this.descartesSeguidos = 0;
        try {
            const cabeza = await this.cabezaDe(topic, partition);
            consumer.seek({ topic, partition, offset: cabeza });
            this.logger.warn(`${Number(cabeza) - Number(offset)} ${MESSAGES.KAFKA.BACKLOG_SKIPPED}`);
        } catch (err) {
            this.logger.error(MESSAGES.KAFKA.SEEK_ERROR, err);
        } finally {
            this.adelantando = false;
        }
    }

    /**
     * Último desplazamiento disponible en una partición del topic.
     *
     * Se pregunta al broker con un cliente de administración de un solo uso
     * (ver {@link conAdmin}).
     */
    private async cabezaDe(topic: string, partition: number): Promise<string> {
        const particiones = await this.conAdmin((admin) => admin.fetchTopicOffsets(topic));
        const suya = particiones.find((candidata) => candidata.partition === partition);
        if (!suya) throw new Error(`El topic ${topic} no tiene la partición ${partition}`);
        return suya.high;
    }

    /**
     * Ejecuta una consulta con un cliente de administración de un solo uso.
     *
     * No se mantiene abierto: sólo hace falta al unirse al grupo o cuando el
     * consumer se quedó atrás, y una conexión ociosa más al broker no aporta
     * nada.
     */
    private async conAdmin<T>(consulta: (admin: Admin) => Promise<T>): Promise<T> {
        const admin = this.cliente.admin();
        await admin.connect();
        try {
            return await consulta(admin);
        } finally {
            await admin.disconnect();
        }
    }
}
