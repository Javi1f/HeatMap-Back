-- Crea la tabla de auditoria. Aditiva e idempotente: no toca otras tablas.

-- Eventos de auditoria de acciones administrativas. El detalle solo lleva
-- identificadores internos, nunca correos ni nombres.
CREATE TABLE IF NOT EXISTS evento_auditoria (
    id_evento   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    fecha       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    id_admin    INT UNSIGNED    NULL,
    tipo        VARCHAR(40)     NOT NULL,
    detalle     VARCHAR(255)    NULL,
    ip_origen   VARCHAR(45)     NULL,

    CONSTRAINT pk_evento_auditoria PRIMARY KEY (id_evento),
    INDEX idx_evento_auditoria_fecha (fecha)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- Para deshacer:
--   DROP TABLE evento_auditoria;
