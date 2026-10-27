-- Crea la tabla de solicitudes de cotización (módulo comercial).
--
-- Hace falta antes de desplegar el módulo de cotización: sin ella, la web
-- pública no puede registrar solicitudes y el panel no puede gestionarlas.
--
-- Solo añade una tabla vacía: no toca capturas ni ninguna otra tabla, y se
-- puede ejecutar de nuevo sin efecto.

-- Solicitudes de cotización que un visitante envía desde la web, sin sesión.
-- El correo de contacto se guarda cifrado (AES-256-GCM, DbFieldCipher), como
-- `admin.email`. `datos` conserva la solicitud tal cual llegó —sin el correo,
-- que ya vive cifrado en su columna— para descargarla como documento .json.
-- `estimacion` congela lo que el estimador respondió al cliente.
CREATE TABLE IF NOT EXISTS solicitud_cotizacion (
    id_solicitud        CHAR(36)  NOT NULL,

    tipo_recinto        ENUM('auditorio', 'centro-convenciones', 'universidad', 'estadio',
                             'centro-comercial', 'plaza-publica', 'otro') NOT NULL,
    organizacion        VARCHAR(120) NOT NULL,
    nombre_contacto     VARCHAR(120) NOT NULL,
    correo_contacto     TEXT         NOT NULL,  -- AES-256-GCM (DbFieldCipher)
    telefono_contacto   VARCHAR(40)  NULL,

    area_m2             INT UNSIGNED NOT NULL,
    aforo_minimo        INT UNSIGNED NOT NULL,
    aforo_maximo        INT UNSIGNED NOT NULL,
    eventos_anuales     INT UNSIGNED NOT NULL,

    datos               JSON         NOT NULL,
    estimacion          JSON         NOT NULL,

    estado              ENUM('nueva', 'en-revision', 'contactada', 'cerrada', 'descartada')
                        NOT NULL DEFAULT 'nueva',
    notas_comerciales   TEXT         NULL,

    ip_origen           VARCHAR(45)  NULL,

    fecha_creacion      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    fecha_actualizacion DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                        ON UPDATE CURRENT_TIMESTAMP(6),

    CONSTRAINT pk_solicitud_cotizacion PRIMARY KEY (id_solicitud),
    CONSTRAINT chk_solicitud_cotizacion_aforo CHECK (aforo_maximo >= aforo_minimo),
    INDEX idx_solicitud_cotizacion_estado (estado),
    INDEX idx_solicitud_cotizacion_fecha (fecha_creacion)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Para deshacer:
--   DROP TABLE solicitud_cotizacion;
