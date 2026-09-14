-- Corrige las medidas de la plazoleta central: 21 m x 11,84 m.
--
-- Los nodos siguen en el mismo sitio fisico, dos en las esquinas de un lado de
-- 21 m y el tercero en el centro del lado opuesto; solo cambian sus
-- coordenadas para ajustarse a la medida real.
--
-- No toca capturas. Es idempotente.

START TRANSACTION;

UPDATE zona
   SET coordenadas = JSON_OBJECT('forma', 'rectangulo', 'ancho', 21.00, 'alto', 11.84),
       descripcion = 'Plazoleta rectangular de 21 m x 11,84 m con tres nodos de captura: las dos esquinas inferiores y el centro del borde superior.'
 WHERE id_zona = 'plazoleta-central';

UPDATE sensor SET pos_x =  0.00, pos_y =  0.00 WHERE id_sensor = 'rpi-sniffer-001';
UPDATE sensor SET pos_x = 21.00, pos_y =  0.00 WHERE id_sensor = 'rpi-sniffer-002';
UPDATE sensor SET pos_x = 10.50, pos_y = 11.84 WHERE id_sensor = 'rpi-sniffer-003';

COMMIT;

-- Para deshacer (medidas anteriores, 17,64 m x 9,10 m):
--   UPDATE zona SET coordenadas = JSON_OBJECT('forma', 'rectangulo', 'ancho', 17.64, 'alto', 9.10)
--    WHERE id_zona = 'plazoleta-central';
--   UPDATE sensor SET pos_x = 17.64, pos_y = 0.00 WHERE id_sensor = 'rpi-sniffer-002';
--   UPDATE sensor SET pos_x =  8.82, pos_y = 9.10 WHERE id_sensor = 'rpi-sniffer-003';
