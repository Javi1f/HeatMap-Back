/**
 * @file estimacion.ts
 * @description Estimador de nodos para la cotización preliminar.
 *
 * Es una función pura: no toca la base ni la red, así que el panel comercial
 * puede recalcularla y los tests ejercitarla sin montar nada.
 *
 * ## De dónde salen las constantes
 *
 * Del despliegue real del piloto (plazoleta central, septiembre 2026):
 *  - Tres nodos cubrieron 248,6 m² con la precisión documentada, que da
 *    **≈ 83 m² por nodo** en aire libre. Esa es la densidad validada de la
 *    que parte el estimador; por tipo de recinto se ajusta según cómo
 *    propagan su señal los muros y los graderíos.
 *  - La presencia exige que **al menos dos nodos** oigan cada dispositivo
 *    (`PRESENCIA_NODOS_MINIMOS`), de modo que el solape entre nodos no es
 *    opcional: está dentro de la densidad, no se cobra aparte.
 *  - El mínimo de tres nodos no es un piso comercial: es el que sostiene la
 *    triangulación con redundancia, el mismo que usó el piloto.
 *
 * ## Lo que NO es este estimador
 *
 * Una cotización cerrada. La etiqueta de todo lo que produce es «estimación
 * preliminar»: el equipo comercial la refina con un levantamiento en sitio.
 * Tampoco estima dinero — solo alcance técnico, por decisión del producto.
 */

/** Tipos de recinto que el estimador conoce. Debe coincidir con el esquema del DTO. */
export const TIPOS_RECINTO = [
    'auditorio',
    'centro-convenciones',
    'universidad',
    'estadio',
    'centro-comercial',
    'plaza-publica',
    'otro',
] as const;

/** Clase de recinto descrita por el cliente. */
export type TipoRecinto = (typeof TIPOS_RECINTO)[number];

/**
 * Área efectiva planificada por nodo, en m², por tipo de recinto.
 *
 * Ya incluye el solape de triangulación (cada punto debe ser oído por
 * ≥ 2 nodos). La plaza pública toma la densidad medida en el piloto;
 * los interiores bajan porque muros, butas y entrepisos atenúan la señal.
 */
export const M2_POR_NODO: Record<TipoRecinto, number> = {
    'plaza-publica': 85,
    auditorio: 75,
    'centro-convenciones': 85,
    universidad: 70,
    estadio: 110,
    'centro-comercial': 65,
    otro: 80,
};

/** Dispositivos simultáneos que un nodo procesa con margen holgado. */
export const DISPOSITIVOS_POR_NODO = 400;

/**
 * Dispositivos estimados por persona asistiendo.
 *
 * El sistema cuenta dispositivos, nunca personas: este factor solo traduce
 * el aforo que la persona entiende a lo que los nodos van a escuchar.
 * Un teléfono con MAC aleatoria suele emitir por más de una interfaz;
 * 0,9 compensa a quienes no llevan teléfono cargado.
 */
export const DISPOSITIVOS_POR_PERSONA = 0.9;

/** Mínimo de nodos: el del piloto, que sostiene la triangulación con redundancia. */
export const NODOS_MINIMOS = 3;

/** A partir de esta cantidad de eventos al año conviene un nodo de repuesto. */
export const EVENTOS_PARA_RESPALDO = 100;

/** Y a partir de esta, dos: el desgaste y la logística se notan. */
export const EVENTOS_PARA_DOS_RESPALDOS = 250;

/** Lo que el cliente describe y el estimador consume. */
export interface EntradaEstimacion {
    tipoRecinto: TipoRecinto;
    /** Área aproximada del recinto, en m². */
    areaM2: number;
    /** Aforo mínimo esperado. */
    aforoMinimo: number;
    /** Aforo máximo esperado. */
    aforoMaximo: number;
    /** Eventos al año. */
    eventosAnuales: number;
    /** Requisitos especiales declarados. */
    requisitos: {
        camaras: boolean;
        analisisRed: boolean;
        seguridadPrivada: boolean;
        ventilacionRemota: boolean;
        notas?: string;
    };
}

/** Una línea del desglose: la cifra y su porqué, en lenguaje llano. */
export interface LineaDesglose {
    titulo: string;
    valor: string;
    detalle: string;
}

/** Resultado del estimador, tal como se guarda y se muestra. */
export interface EstimacionCotizacion {
    /** Nodos totales recomendados: operativos + respaldo. */
    nodos: number;
    /** Nodos de cobertura del recinto. */
    nodosOperativos: number;
    /** Nodos de repuesto que sugiere el ritmo de eventos. */
    nodosRespaldo: number;
    /** Dispositivos que se espera escuchar en el pico, según el aforo máximo. */
    dispositivosEstimados: number;
    /** Área efectiva planificada por nodo usada en el cálculo, en m². */
    m2PorNodo: number;
    /** Cada cifra con su porqué. */
    desglose: LineaDesglose[];
    /** Integraciones que pide el cliente, en términos del sistema. */
    integraciones: string[];
    /** Límites honestos y contexto, siempre visibles junto a la cifra. */
    notas: string[];
}

/** Texto fijo de cada integración, en el vocabulario del sistema. */
const INTEGRACIONES: Record<keyof EntradaEstimacion['requisitos'], string> = {
    camaras: 'Enlace con el sistema de cámaras existente: referencias para verificar el aforo en sitio.',
    analisisRed: 'Correlación con la herramienta de análisis de red que ya opera el recinto.',
    seguridadPrivada: 'Puente con el centro de seguridad privada: las alertas de aglomeración entran a su flujo de operación.',
    ventilacionRemota: 'Conexión del sistema de ventilación remoto a las alertas de ocupación del sistema.',
    notas: '',
};

/**
 * Estima los nodos y el alcance de un despliegue a partir de lo que el
 * cliente describió.
 *
 * @param entrada - Solicitud tal cual la describió el cliente.
 * @returns Estimación preliminar con el desglose explicado.
 */
export const estimarNodos = (entrada: EntradaEstimacion): EstimacionCotizacion => {
    const m2PorNodo = M2_POR_NODO[entrada.tipoRecinto];
    const porArea = Math.ceil(entrada.areaM2 / m2PorNodo);

    const dispositivos = Math.ceil(entrada.aforoMaximo * DISPOSITIVOS_POR_PERSONA);
    const porAforo = Math.ceil(dispositivos / DISPOSITIVOS_POR_NODO);

    const operativos = Math.max(NODOS_MINIMOS, porArea, porAforo);

    const respaldo =
        entrada.eventosAnuales >= EVENTOS_PARA_DOS_RESPALDOS ? 2 :
        entrada.eventosAnuales >= EVENTOS_PARA_RESPALDO ? 1 : 0;

    const desglose: LineaDesglose[] = [
        {
            titulo: 'Por el área',
            valor: `${porArea} ${porArea === 1 ? 'nodo' : 'nodos'}`,
            detalle:
                `${entrada.areaM2.toLocaleString('es-CO')} m² ÷ ${m2PorNodo} m² por nodo, con el solape que exige ` +
                'que dos nodos oigan a cada dispositivo (la densidad viene del piloto de la plazoleta).',
        },
        {
            titulo: 'Por el aforo',
            valor: `${porAforo} ${porAforo === 1 ? 'nodo' : 'nodos'}`,
            detalle:
                `Aforo máximo ${entrada.aforoMaximo.toLocaleString('es-CO')} ≈ ${dispositivos.toLocaleString('es-CO')} dispositivos ` +
                `en el pico (el sistema cuenta dispositivos, no personas) ÷ ${DISPOSITIVOS_POR_NODO} por nodo.`,
        },
        {
            titulo: 'Mínimo del piloto',
            valor: `${NODOS_MINIMOS} nodos`,
            detalle:
                'La posición se estima cruzando señales de al menos dos nodos; con tres hay redundancia ' +
                'y el error no favorece a ninguna mitad del espacio.',
        },
    ];

    if (respaldo > 0) {
        desglose.push({
            titulo: 'Nodos de repuesto',
            valor: `${respaldo} ${respaldo === 1 ? 'nodo' : 'nodos'}`,
            detalle:
                `Con ${entrada.eventosAnuales.toLocaleString('es-CO')} eventos al año conviene un repuesto para reemplazar ` +
                'un nodo caído sin esperar logística.',
        });
    }

    const integraciones = (Object.keys(INTEGRACIONES) as Array<keyof typeof INTEGRACIONES>)
        .filter((clave) => clave !== 'notas' && entrada.requisitos[clave])
        .map((clave) => INTEGRACIONES[clave]);

    const notas = [
        'Cada nodo es una Raspberry Pi con Kismet: hardware commodity, sin obra civil.',
        'El sistema cuenta dispositivos, no personas: el aforo se traduce a dispositivos antes de estimar.',
        'Estimación preliminar generada automáticamente; el equipo comercial la refina con un levantamiento en sitio.',
    ];

    if (operativos > 60) {
        notas.push(
            'Cobertura completa de un recinto tan grande se despliega por fases: el equipo comercial propone una fase inicial con las zonas de mayor afluencia.',
        );
    }

    return {
        nodos: operativos + respaldo,
        nodosOperativos: operativos,
        nodosRespaldo: respaldo,
        dispositivosEstimados: dispositivos,
        m2PorNodo,
        desglose,
        integraciones,
        notas,
    };
};
