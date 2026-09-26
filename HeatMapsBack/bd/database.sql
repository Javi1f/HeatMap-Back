-- ════════════════════════════════════════════════════════════════════
-- Esquema de PlaceAt sobre MySQL 8.
--
-- Implementa el modelo relacional del documento (Anexo 13): las nueve
-- entidades CORREO_PERMITIDO, ADMIN, SESION_AUTH, ZONA, SENSOR, CAPTURA,
-- OCUPACION_AGREGADA, ALERTA y REPORTE, con sus identificadores UUID y sus
-- claves foráneas. Tres tablas de apoyo completan requerimientos que el modelo
-- no dibuja:
--   · registro_pendiente         → alta con verificación por correo (MFA).
--   · evento_auditoria           → RF-13 y RNF-09, logs de auditoría.
--   · dispositivo_infraestructura → RF-11, depuración de lo que no es un
--                                    ocupante (puntos de acceso, nodos).
--
-- Diferencias deliberadas con el modelo, por requerimientos de seguridad:
--   · email y username se guardan cifrados (RNF-13) y su unicidad se exige
--     sobre un hash (`*_hash`), porque el cifrado con IV aleatorio no deja
--     comparar textos cifrados.
--   · En MySQL no hay tipo UUID: los identificadores UUID son CHAR(36).
--
-- Este archivo es la fuente del esquema. Las entidades TypeORM lo reflejan
-- columna a columna, índice a índice (`npm run bd:deriva` lo comprueba), y
-- DB_SYNCHRONIZE va siempre en false.
-- ════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS bdproyectodegrado
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE bdproyectodegrado;

-- ── Gestión de acceso ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin (
    id_admin              CHAR(36)     NOT NULL,

    username              TEXT         NOT NULL,
    username_hash         CHAR(64)     NOT NULL,
    email                 TEXT         NOT NULL,
    email_hash            CHAR(64)     NOT NULL,

    password_hash         TEXT         NOT NULL,

    rol                   ENUM('root', 'admin') NOT NULL DEFAULT 'admin',

    mfa_secret            VARCHAR(255) NULL,

    verificado            BOOLEAN      NOT NULL DEFAULT FALSE,

    activo                BOOLEAN      NOT NULL DEFAULT TRUE,

    fecha_creacion        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    fecha_actualizacion   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                       ON UPDATE CURRENT_TIMESTAMP(6),
    ultimo_acceso         DATETIME     NULL,

    CONSTRAINT pk_admin PRIMARY KEY (id_admin),
    CONSTRAINT uq_admin_username_hash UNIQUE (username_hash),
    CONSTRAINT uq_admin_email_hash UNIQUE (email_hash)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS correo_permitido (
    id_correo      CHAR(36)     NOT NULL,

    email          TEXT         NOT NULL,
    email_hash     CHAR(64)     NOT NULL,

    -- Administrador que autorizó el correo. NULL para el correo fundador, que
    -- se da de alta al instalar, antes de que exista ningún administrador.
    anadido_por    CHAR(36)     NULL,

    fecha_anadido  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    -- El correo del administrador raíz: nadie puede eliminarlo, ni él mismo.
    es_fundador    BOOLEAN      NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_correo_permitido PRIMARY KEY (id_correo),
    CONSTRAINT uq_correo_permitido_hash UNIQUE (email_hash),
    CONSTRAINT fk_correo_permitido_admin
        FOREIGN KEY (anadido_por) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_correo_permitido_anadido_por (anadido_por)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS registro_pendiente (
    id_registro    INT UNSIGNED NOT NULL AUTO_INCREMENT,

    username       TEXT         NOT NULL,
    username_hash  CHAR(64)     NOT NULL,
    email          TEXT         NOT NULL,
    email_hash     CHAR(64)     NOT NULL,
    password_hash  TEXT         NOT NULL,

    codigo         TEXT         NOT NULL,

    fecha_expiracion DATETIME   NOT NULL,
    intentos       INT UNSIGNED NOT NULL DEFAULT 0,
    fecha_creacion DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT pk_registro_pendiente PRIMARY KEY (id_registro),
    CONSTRAINT uq_registro_pendiente_username_hash UNIQUE (username_hash),
    CONSTRAINT uq_registro_pendiente_email_hash UNIQUE (email_hash),
    INDEX idx_registro_pendiente_expiracion (fecha_expiracion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sesion_auth (
    id_sesion         CHAR(36)     NOT NULL,
    id_admin          CHAR(36)     NOT NULL,

    token_hash        CHAR(64)     NOT NULL,

    ip_origen         VARCHAR(45)  NULL,
    fecha_inicio      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    fecha_expiracion  DATETIME     NOT NULL,
    revocada          BOOLEAN      NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_sesion_auth PRIMARY KEY (id_sesion),
    CONSTRAINT uq_sesion_auth_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_sesion_auth_admin
        FOREIGN KEY (id_admin) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_sesion_auth_admin (id_admin),
    INDEX idx_sesion_auth_expiracion (fecha_expiracion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Eventos de auditoría de acciones administrativas (RF-13, RNF-09). El detalle
-- solo lleva identificadores internos, nunca correos ni nombres. `id_admin` no
-- es clave foránea a propósito: la traza tiene que sobrevivir a la cuenta.
CREATE TABLE IF NOT EXISTS evento_auditoria (
    id_evento   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    fecha       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    id_admin    CHAR(36)        NULL,
    tipo        VARCHAR(40)     NOT NULL,
    detalle     VARCHAR(255)    NULL,
    ip_origen   VARCHAR(45)     NULL,

    CONSTRAINT pk_evento_auditoria PRIMARY KEY (id_evento),
    INDEX idx_evento_auditoria_fecha (fecha)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ── Infraestructura operativa ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS zona (
    id_zona        CHAR(36)     NOT NULL,
    nombre         VARCHAR(100) NOT NULL,
    descripcion    TEXT         NULL,

    capacidad_max  INT UNSIGNED NULL,

    coordenadas    JSON         NULL,

    activa         BOOLEAN      NOT NULL DEFAULT TRUE,
    fecha_creacion DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT pk_zona PRIMARY KEY (id_zona),
    CONSTRAINT uq_zona_nombre UNIQUE (nombre)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sensor (
    id_sensor        VARCHAR(50)  NOT NULL,

    nombre           VARCHAR(100) NOT NULL,
    id_zona          CHAR(36)     NOT NULL,
    estado           ENUM('activo', 'inactivo', 'mantenimiento')
                                  NOT NULL DEFAULT 'activo',
    ip_local         VARCHAR(45)  NULL,

    ultima_conexion  DATETIME     NULL,

    fecha_registro   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    registrado_por   CHAR(36)     NULL,

    pos_x            DECIMAL(6,2) NULL COMMENT 'Metros desde el borde izquierdo de la zona',
    pos_y            DECIMAL(6,2) NULL COMMENT 'Metros desde el borde inferior de la zona',

    CONSTRAINT pk_sensor PRIMARY KEY (id_sensor),
    CONSTRAINT fk_sensor_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sensor_registrado_por
        FOREIGN KEY (registrado_por) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sensor_zona (id_zona),
    INDEX idx_sensor_estado (estado),
    INDEX idx_sensor_registrado_por (registrado_por)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS captura (
    id_captura         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- HMAC-SHA256 de la MAC. La MAC en claro nunca se almacena (RF-02).
    mac_hash           CHAR(64)     NOT NULL,

    id_sensor          VARCHAR(50)  NOT NULL,

    rssi               SMALLINT     NOT NULL,

    distancia_estimada DECIMAL(5,2) NULL,

    canal              SMALLINT UNSIGNED NOT NULL,
    tipo_trama         VARCHAR(20)  NOT NULL,

    es_mac_random      BOOLEAN      NOT NULL DEFAULT FALSE,

    timestamp_captura  DATETIME(3)  NOT NULL,
    fecha_ingesta      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT pk_captura PRIMARY KEY (id_captura),
    CONSTRAINT fk_captura_sensor
        FOREIGN KEY (id_sensor) REFERENCES sensor (id_sensor)
        ON UPDATE CASCADE ON DELETE CASCADE,

    INDEX idx_captura_sensor_timestamp (id_sensor, timestamp_captura),
    INDEX idx_captura_mac_timestamp (mac_hash, timestamp_captura),
    INDEX idx_captura_timestamp (timestamp_captura)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Dispositivos que no cuentan como ocupantes: puntos de acceso, equipos pegados
-- a un nodo y exclusiones manuales. Se clasifican al ingerir, que es el único
-- momento en que se ve la MAC en claro. Nunca guarda la MAC, solo su HMAC.
CREATE TABLE IF NOT EXISTS dispositivo_infraestructura (
    mac_hash           CHAR(64)     NOT NULL,

    motivo             ENUM('punto-de-acceso', 'junto-a-nodo', 'manual') NOT NULL,

    primera_deteccion  DATETIME     NOT NULL,
    ultima_deteccion   DATETIME     NOT NULL,

    CONSTRAINT pk_dispositivo_infraestructura PRIMARY KEY (mac_hash),

    INDEX idx_dispositivo_infraestructura_ultima (ultima_deteccion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ── Análisis de información ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ocupacion_agregada (
    id_ocupacion          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_zona               CHAR(36)     NOT NULL,

    intervalo_inicio      DATETIME     NOT NULL,
    intervalo_fin         DATETIME     NOT NULL,

    dispositivos_unicos   INT UNSIGNED NOT NULL DEFAULT 0,

    dispositivos_estables INT UNSIGNED NOT NULL DEFAULT 0,

    rssi_promedio         DECIMAL(5,2) NULL,
    nivel_ocupacion       ENUM('baja', 'media', 'alta') NOT NULL DEFAULT 'baja',

    CONSTRAINT pk_ocupacion_agregada PRIMARY KEY (id_ocupacion),
    CONSTRAINT fk_ocupacion_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_ocupacion_intervalo CHECK (intervalo_fin > intervalo_inicio),
    INDEX idx_ocupacion_zona_intervalo (id_zona, intervalo_inicio),
    INDEX idx_ocupacion_nivel (nivel_ocupacion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerta (
    id_alerta         CHAR(36)  NOT NULL,
    id_zona           CHAR(36)  NOT NULL,
    nivel             ENUM('advertencia', 'critica') NOT NULL,
    mensaje           TEXT      NOT NULL,
    timestamp_alerta  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    resuelta          BOOLEAN   NOT NULL DEFAULT FALSE,

    resuelta_por      CHAR(36)  NULL,

    CONSTRAINT pk_alerta PRIMARY KEY (id_alerta),
    CONSTRAINT fk_alerta_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_alerta_resuelta_por
        FOREIGN KEY (resuelta_por) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_alerta_zona_timestamp (id_zona, timestamp_alerta),
    INDEX idx_alerta_resuelta (resuelta),
    INDEX idx_alerta_resuelta_por (resuelta_por)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reporte (
    id_reporte       CHAR(36)     NOT NULL,
    id_admin         CHAR(36)     NOT NULL,

    id_zona          CHAR(36)     NULL,

    tipo_reporte     VARCHAR(50)  NOT NULL,
    rango_inicio     DATETIME     NOT NULL,
    rango_fin        DATETIME     NOT NULL,

    parametros       JSON         NULL,

    fecha_generacion DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    CONSTRAINT pk_reporte PRIMARY KEY (id_reporte),
    CONSTRAINT fk_reporte_admin
        FOREIGN KEY (id_admin) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_reporte_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_reporte_rango CHECK (rango_fin > rango_inicio),
    INDEX idx_reporte_admin (id_admin),
    INDEX idx_reporte_zona (id_zona),
    INDEX idx_reporte_fecha (fecha_generacion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ── Espacio monitorizado ──────────────────────────────────────────────

SET @id_zona = 'plazoleta-central';

INSERT INTO zona (id_zona, nombre, descripcion, capacidad_max, coordenadas, activa)
VALUES (
    @id_zona,
    'Plazoleta central',
    'Plazoleta rectangular de 21 m x 11,84 m con tres nodos de captura: las dos esquinas inferiores y el centro del borde superior.',
    NULL,
    JSON_OBJECT('forma', 'rectangulo', 'ancho', 21.00, 'alto', 11.84),
    TRUE
)
ON DUPLICATE KEY UPDATE
    descripcion = VALUES(descripcion),
    coordenadas = VALUES(coordenadas),
    activa      = VALUES(activa);

INSERT INTO sensor (id_sensor, nombre, id_zona, estado, pos_x, pos_y)
VALUES
    -- Triangulo isosceles: dos esquinas inferiores y el centro del borde
    -- superior. Es simetrico respecto al eje vertical, asi que el error de
    -- posicion no favorece a ninguna mitad de la plaza.
    ('rpi-sniffer-001', 'Nodo 1', @id_zona, 'activo',  0.00, 0.00),
    ('rpi-sniffer-002', 'Nodo 2', @id_zona, 'activo', 21.00, 0.00),
    ('rpi-sniffer-003', 'Nodo 3', @id_zona, 'activo', 10.50, 11.84)
ON DUPLICATE KEY UPDATE
    nombre  = VALUES(nombre),
    id_zona = VALUES(id_zona),
    pos_x   = VALUES(pos_x),
    pos_y   = VALUES(pos_y);
