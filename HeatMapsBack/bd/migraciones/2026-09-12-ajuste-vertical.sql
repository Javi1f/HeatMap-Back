-- Corrige el sesgo vertical del mapa de la plazoleta central.
--
-- Un portatil quieto en el centro del triangulo de nodos (10,5; 3,95) salia de
-- media en y = 1,2 m: 2,8 m por debajo. Se suben 2,5 m todas las posiciones del
-- mapa de esta zona. Ver "Correccion vertical" en bd/README.md.
--
-- Solo cambia la geometria de la zona. Es idempotente.

UPDATE zona
   SET coordenadas = JSON_SET(coordenadas, '$.ajusteVerticalM', 2.5)
 WHERE id_zona = 'plazoleta-central';

-- Para deshacer:
--   UPDATE zona SET coordenadas = JSON_REMOVE(coordenadas, '$.ajusteVerticalM')
--    WHERE id_zona = 'plazoleta-central';
