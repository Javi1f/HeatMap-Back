CREATE DATABASE IF NOT EXISTS placeat
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE placeat;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS sesion_auth;
DROP TABLE IF EXISTS reporte;
DROP TABLE IF EXISTS alerta;
DROP TABLE IF EXISTS ocupacion_agregada;
DROP TABLE IF EXISTS captura;
DROP TABLE IF EXISTS sensor;
DROP TABLE IF EXISTS zona;
DROP TABLE IF EXISTS admin;
DROP TABLE IF EXISTS correo_permitido;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE correo_permitido (
    id_correo CHAR(36) NOT NULL,
    email VARCHAR(100) NOT NULL,
    anadido_por CHAR(36) NULL,
    fecha_anadido TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    es_fundador BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_correo_permitido PRIMARY KEY (id_correo),
    CONSTRAINT uq_correo_permitido_email UNIQUE (email)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE admin (
    id_admin CHAR(36) NOT NULL,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol ENUM('root', 'admin') NOT NULL DEFAULT 'admin',
    mfa_secret VARCHAR(255) NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_acceso TIMESTAMP NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_admin PRIMARY KEY (id_admin),
    CONSTRAINT uq_admin_username UNIQUE (username),
    CONSTRAINT uq_admin_email UNIQUE (email),
    CONSTRAINT fk_admin_email
        FOREIGN KEY (email)
        REFERENCES correo_permitido (email)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

ALTER TABLE correo_permitido
    ADD CONSTRAINT fk_correo_permitido_anadido_por
        FOREIGN KEY (anadido_por)
        REFERENCES admin (id_admin)
        ON UPDATE CASCADE
        ON DELETE SET NULL;

CREATE TABLE sesion_auth (
    id_sesion CHAR(36) NOT NULL,
    id_admin CHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    ip_origen VARCHAR(45) NULL,
    fecha_inicio TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion TIMESTAMP NOT NULL,
    revocada BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT pk_sesion_auth PRIMARY KEY (id_sesion),
    CONSTRAINT fk_sesion_auth_id_admin
        FOREIGN KEY (id_admin)
        REFERENCES admin (id_admin)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    INDEX idx_sesion_auth_id_admin (id_admin),
    INDEX idx_sesion_auth_fecha_expiracion (fecha_expiracion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE zona (
    id_zona CHAR(36) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT NULL,
    capacidad_max INT UNSIGNED NULL,
    coordenadas JSON NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_zona PRIMARY KEY (id_zona),
    CONSTRAINT uq_zona_nombre UNIQUE (nombre)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE sensor (
    id_sensor VARCHAR(50) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    id_zona CHAR(36) NOT NULL,
    estado ENUM('activo', 'inactivo', 'mantenimiento') NOT NULL DEFAULT 'activo',
    ip_local VARCHAR(45) NULL,
    ultima_conexion TIMESTAMP NULL,
    fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    registrado_por CHAR(36) NULL,
    CONSTRAINT pk_sensor PRIMARY KEY (id_sensor),
    CONSTRAINT fk_sensor_id_zona
        FOREIGN KEY (id_zona)
        REFERENCES zona (id_zona)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_sensor_registrado_por
        FOREIGN KEY (registrado_por)
        REFERENCES admin (id_admin)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    INDEX idx_sensor_id_zona (id_zona),
    INDEX idx_sensor_estado (estado)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE captura (
    id_captura BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    mac_hash CHAR(64) NOT NULL,
    id_sensor VARCHAR(50) NOT NULL,
    rssi SMALLINT NOT NULL,
    distancia_estimada DECIMAL(5,2) NULL,
    canal SMALLINT UNSIGNED NOT NULL,
    tipo_trama VARCHAR(20) NOT NULL,
    es_mac_random BOOLEAN NOT NULL DEFAULT FALSE,
    timestamp_captura TIMESTAMP(3) NOT NULL,
    fecha_ingesta TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT pk_captura PRIMARY KEY (id_captura),
    CONSTRAINT fk_captura_id_sensor
        FOREIGN KEY (id_sensor)
        REFERENCES sensor (id_sensor)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    INDEX idx_captura_sensor_timestamp (id_sensor, timestamp_captura),
    INDEX idx_captura_mac_timestamp (mac_hash, timestamp_captura),
    INDEX idx_captura_timestamp (timestamp_captura)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE ocupacion_agregada (
    id_ocupacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_zona CHAR(36) NOT NULL,
    intervalo_inicio TIMESTAMP NOT NULL,
    intervalo_fin TIMESTAMP NOT NULL,
    dispositivos_unicos INT UNSIGNED NOT NULL DEFAULT 0,
    dispositivos_estables INT UNSIGNED NOT NULL DEFAULT 0,
    rssi_promedio DECIMAL(5,2) NULL,
    nivel_ocupacion ENUM('baja', 'media', 'alta') NOT NULL,
    CONSTRAINT pk_ocupacion_agregada PRIMARY KEY (id_ocupacion),
    CONSTRAINT fk_ocupacion_id_zona
        FOREIGN KEY (id_zona)
        REFERENCES zona (id_zona)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT chk_ocupacion_intervalo CHECK (intervalo_fin > intervalo_inicio),
    INDEX idx_ocupacion_zona_intervalo (id_zona, intervalo_inicio),
    INDEX idx_ocupacion_nivel (nivel_ocupacion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE alerta (
    id_alerta CHAR(36) NOT NULL,
    id_zona CHAR(36) NOT NULL,
    nivel ENUM('advertencia', 'critica') NOT NULL,
    mensaje TEXT NOT NULL,
    timestamp_alerta TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resuelta BOOLEAN NOT NULL DEFAULT FALSE,
    resuelta_por CHAR(36) NULL,
    CONSTRAINT pk_alerta PRIMARY KEY (id_alerta),
    CONSTRAINT fk_alerta_id_zona
        FOREIGN KEY (id_zona)
        REFERENCES zona (id_zona)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_alerta_resuelta_por
        FOREIGN KEY (resuelta_por)
        REFERENCES admin (id_admin)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    INDEX idx_alerta_zona_timestamp (id_zona, timestamp_alerta),
    INDEX idx_alerta_resuelta (resuelta)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE reporte (
    id_reporte CHAR(36) NOT NULL,
    id_admin CHAR(36) NOT NULL,
    id_zona CHAR(36) NULL,
    tipo_reporte VARCHAR(50) NOT NULL,
    rango_inicio TIMESTAMP NOT NULL,
    rango_fin TIMESTAMP NOT NULL,
    parametros JSON NULL,
    fecha_generacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_reporte PRIMARY KEY (id_reporte),
    CONSTRAINT fk_reporte_id_admin
        FOREIGN KEY (id_admin)
        REFERENCES admin (id_admin)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT fk_reporte_id_zona
        FOREIGN KEY (id_zona)
        REFERENCES zona (id_zona)
        ON UPDATE CASCADE
        ON DELETE SET NULL,
    CONSTRAINT chk_reporte_rango CHECK (rango_fin > rango_inicio),
    INDEX idx_reporte_admin (id_admin),
    INDEX idx_reporte_zona (id_zona),
    INDEX idx_reporte_fecha (fecha_generacion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;