-- Reubica los tres nodos de la plazoleta central.
--
-- De tres esquinas (asimetrico) al triangulo isosceles: dos esquinas
-- inferiores y el centro del borde superior. Ver la seccion "El espacio
-- monitorizado" de bd/README.md para la medicion que justifica el cambio.
--
-- Solo mueve coordenadas: no toca capturas, zonas ni sesiones.
-- Es idempotente y se puede volver a ejecutar sin efecto.

START TRANSACTION;

SELECT id_sensor, nombre, pos_x, pos_y FROM sensor ORDER BY id_sensor;

UPDATE sensor SET pos_x =  0.00, pos_y = 0.00 WHERE id_sensor = 'rpi-sniffer-001';
UPDATE sensor SET pos_x = 17.64, pos_y = 0.00 WHERE id_sensor = 'rpi-sniffer-002';
UPDATE sensor SET pos_x =  8.82, pos_y = 9.10 WHERE id_sensor = 'rpi-sniffer-003';

UPDATE zona
   SET descripcion = 'Plazoleta rectangular de 17,64 m x 9,10 m con tres nodos de captura: las dos esquinas inferiores y el centro del borde superior.'
 WHERE id_zona = 'plazoleta-central';

SELECT id_sensor, nombre, pos_x, pos_y FROM sensor ORDER BY id_sensor;

COMMIT;

-- Para deshacer:
--   UPDATE sensor SET pos_x =  0.00, pos_y = 0.00 WHERE id_sensor = 'rpi-sniffer-001';
--   UPDATE sensor SET pos_x =  0.00, pos_y = 9.10 WHERE id_sensor = 'rpi-sniffer-002';
--   UPDATE sensor SET pos_x = 17.64, pos_y = 9.10 WHERE id_sensor = 'rpi-sniffer-003';
