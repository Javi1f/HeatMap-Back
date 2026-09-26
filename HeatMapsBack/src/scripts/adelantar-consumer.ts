/**
 * Muestra el atraso del grupo de consumidores y lo adelanta a la cabeza del
 * topic.
 *
 * **No hace falta para arrancar**: el consumer salta solo la cola caducada al
 * unirse al grupo, y se adelanta a la cabeza si durante el consumo lleva más de
 * un minuto descartando todo (ver `kafka-consumer.service.ts`). Este comando
 * queda como diagnóstico, sobre todo para **ver quién está en el grupo**: si
 * aparece más de un miembro, hay dos backends compitiendo por la misma
 * partición y ese es el problema de fondo, no el atraso.
 *
 * Kafka no permite mover el desplazamiento de un grupo con miembros activos, así
 * que hay que parar los backends antes. Sin `--mover` no escribe nada.
 *
 * Uso:
 *   `npm run kafka:atraso`
 *   `npm run kafka:atraso -- --mover`
 */
import '../loadEnv';
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Admin, Kafka } from 'kafkajs';
import { KafkaConfig } from '../config/kafka.config';

/** Escribe una línea en la salida estándar. */
const escribir = (linea: string): void => {
    process.stdout.write(`${linea}\n`);
};

/** Atraso de una partición: cuántos mensajes hay publicados que el grupo no ha leído. */
export interface AtrasoDeParticion {
    /** Partición del topic. */
    particion: number;

    /** Desplazamiento del siguiente mensaje que se publicará. */
    cabeza: number;

    /** Desplazamiento por el que va el grupo, o `null` si nunca confirmó ninguno. */
    grupo: number | null;

    /** Mensajes publicados que el grupo todavía no ha leído. */
    atraso: number;
}

/**
 * Atraso del grupo en cada partición del topic.
 *
 * Un grupo sin desplazamiento confirmado no está atrasado: empezará por donde le
 * diga su configuración, así que cuenta como cero.
 */
export const atrasoPorParticion = (
    cabezas: readonly { partition: number; high: string }[],
    delGrupo: readonly { partition: number; offset: string }[],
): AtrasoDeParticion[] => cabezas.map((cabeza) => {
    const confirmado = delGrupo.find((suyo) => suyo.partition === cabeza.partition)?.offset;
    const grupo = confirmado === undefined || Number(confirmado) < 0 ? null : Number(confirmado);
    return {
        particion: cabeza.partition,
        cabeza: Number(cabeza.high),
        grupo,
        atraso: grupo === null ? 0 : Number(cabeza.high) - grupo,
    };
});

/** Describe a los miembros del grupo y devuelve cuántos hay. */
const informarMiembros = async (admin: Admin, groupId: string): Promise<number> => {
    const { groups } = await admin.describeGroups([groupId]);
    const grupo = groups[0];
    escribir(`Grupo ${groupId}: estado ${grupo.state}, ${grupo.members.length} miembro(s)`);
    for (const miembro of grupo.members) {
        escribir(`  ${miembro.clientId} desde ${miembro.clientHost}`);
    }
    if (grupo.members.length > 1) {
        escribir('  Hay más de un consumidor en el grupo: sólo uno lee la partición y cada entrada o');
        escribir('  salida reequilibra el grupo y detiene la lectura. Usa otro KAFKA_GROUP_ID en local.');
    }
    return grupo.members.length;
};

/** Informa del atraso de cada partición y devuelve el total. */
const informarAtraso = async (admin: Admin, cfg: KafkaConfig): Promise<number> => {
    const [cabezas, delGrupo] = await Promise.all([
        admin.fetchTopicOffsets(cfg.topic),
        admin.fetchOffsets({ groupId: cfg.groupId, topics: [cfg.topic] }),
    ]);

    const filas = atrasoPorParticion(cabezas, delGrupo[0]?.partitions ?? []);
    for (const fila of filas) {
        escribir(`  partición ${fila.particion}: cabeza ${fila.cabeza}, grupo ${fila.grupo ?? 'sin confirmar'}, atraso ${fila.atraso} mensajes`);
    }
    return filas.reduce((total, fila) => total + fila.atraso, 0);
};

/**
 * Mueve el desplazamiento del grupo a la cabeza del topic.
 *
 * Lo que queda por detrás se pierde a propósito: son lecturas que el criterio de
 * antigüedad iba a descartar de todas formas.
 */
const mover = async (admin: Admin, cfg: KafkaConfig, miembros: number): Promise<void> => {
    if (miembros > 0) {
        escribir('\nNo se puede mover el desplazamiento mientras el grupo tiene miembros activos.');
        escribir('Para el backend (y cualquier instancia local), vuelve a ejecutarlo y arráncalo después.');
        process.exitCode = 1;
        return;
    }

    await admin.resetOffsets({ groupId: cfg.groupId, topic: cfg.topic, earliest: false });
    escribir('\nDesplazamiento movido a la cabeza del topic. Al arrancar, el backend leerá sólo lecturas nuevas.');
};

/** Punto de entrada: informa del estado del grupo y, con `--mover`, lo adelanta. */
export const principal = async (): Promise<void> => {
    const opcion = process.argv[2];
    if (opcion !== undefined && opcion !== '--mover') {
        escribir('Uso: npm run kafka:atraso -- [--mover]');
        process.exitCode = 1;
        return;
    }

    const cfg = container.resolve(KafkaConfig);
    const kafka = new Kafka({ clientId: 'kafka-atraso', brokers: cfg.brokers, ssl: cfg.ssl });
    const admin = kafka.admin();
    await admin.connect();
    try {
        escribir(`Topic ${cfg.topic} | límite de antigüedad ${cfg.maxMessageAgeSeconds} s`);
        const miembros = await informarMiembros(admin, cfg.groupId);
        const atraso = await informarAtraso(admin, cfg);

        if (opcion === '--mover') {
            await mover(admin, cfg, miembros);
            return;
        }
        if (atraso > 0) {
            escribir('\nSi el atraso supera el límite de antigüedad, el backend descarta todo lo que lee y');
            escribir('no guarda capturas. Lo salta solo al arrancar y tras un minuto descartando; a mano, con --mover.');
        }
    } finally {
        await admin.disconnect();
    }
};

if (require.main === module) {
    principal().catch((err: unknown) => {
        process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 1;
    });
}
