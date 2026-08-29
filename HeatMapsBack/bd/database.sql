CREATE DATABASE IF NOT EXISTS bdproyectodegrado
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE bdproyectodegrado;

CREATE TABLE IF NOT EXISTS correo_permitido (
    id_correo      INT UNSIGNED NOT NULL AUTO_INCREMENT,

    email          TEXT         NOT NULL,
    email_hash     CHAR(64)     NOT NULL,

    anadido_por    TEXT         NULL,

    fecha_anadido  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    es_fundador    BOOLEAN      NOT NULL DEFAULT FALSE,

    CONSTRAINT pk_correo_permitido PRIMARY KEY (id_correo),
    CONSTRAINT uq_correo_permitido_hash UNIQUE (email_hash)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin (
    id_admin              INT UNSIGNED NOT NULL AUTO_INCREMENT,

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
    id_admin          INT UNSIGNED NOT NULL,

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

    registrado_por   INT UNSIGNED NULL,

    pos_x            DECIMAL(6,2) NULL,
    pos_y            DECIMAL(6,2) NULL,

    CONSTRAINT pk_sensor PRIMARY KEY (id_sensor),
    CONSTRAINT fk_sensor_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sensor_registrado_por
        FOREIGN KEY (registrado_por) REFERENCES admin (id_admin)
        ON UPDATE CASCADE ON DELETE SET NULL,
    INDEX idx_sensor_zona (id_zona),
    INDEX idx_sensor_estado (estado)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS captura (
    id_captura         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

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

    resuelta_por      TEXT      NULL,

    CONSTRAINT pk_alerta PRIMARY KEY (id_alerta),
    CONSTRAINT fk_alerta_zona
        FOREIGN KEY (id_zona) REFERENCES zona (id_zona)
        ON UPDATE CASCADE ON DELETE CASCADE,
    INDEX idx_alerta_zona_timestamp (id_zona, timestamp_alerta),
    INDEX idx_alerta_resuelta (resuelta)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reporte (
    id_reporte       CHAR(36)     NOT NULL,
    id_admin         INT UNSIGNED NOT NULL,

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

SET @id_zona = 'plazoleta-central';

INSERT INTO zona (id_zona, nombre, descripcion, capacidad_max, coordenadas, activa)
VALUES (
    @id_zona,
    'Plazoleta central',
    'Plazoleta rectangular de 17,64 m x 9,10 m con tres nodos de captura en las esquinas.',
    NULL,
    JSON_OBJECT('forma', 'rectangulo', 'ancho', 17.64, 'alto', 9.10),
    TRUE
)
ON DUPLICATE KEY UPDATE
    descripcion = VALUES(descripcion),
    coordenadas = VALUES(coordenadas),
    activa      = VALUES(activa);

INSERT INTO sensor (id_sensor, nombre, id_zona, estado, pos_x, pos_y)
VALUES
    ('raspberry-1', 'Nodo 1', @id_zona, 'activo',  0.00, 0.00),
    ('raspberry-2', 'Nodo 2', @id_zona, 'activo',  0.00, 9.10),
    ('raspberry-3', 'Nodo 3', @id_zona, 'activo', 17.64, 9.10)
ON DUPLICATE KEY UPDATE
    nombre  = VALUES(nombre),
    id_zona = VALUES(id_zona),
    pos_x   = VALUES(pos_x),
    pos_y   = VALUES(pos_y);
