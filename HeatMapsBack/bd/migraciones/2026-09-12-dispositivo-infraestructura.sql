-- Crea la tabla de dispositivos de infraestructura.
--
-- Hace falta antes de desplegar el backend que filtra la presencia: sin ella,
-- el mapa, la ocupacion y el panel fallan al consultar las exclusiones.
--
-- Solo anade una tabla vacia: no toca capturas ni ninguna otra tabla, y se
-- puede ejecutar de nuevo sin efecto.

-- Dispositivos que no cuentan como ocupantes: puntos de acceso, equipos pegados
-- a un nodo y exclusiones manuales. Se clasifican al ingerir, que es el unico
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

-- Para deshacer:
--   DROP TABLE dispositivo_infraestructura;
