# Base de datos

Esquema relacional del sistema, sobre **MySQL 8**.

## Un solo archivo

`database.sql` contiene todo lo necesario: la estructura de las diez tablas y el
alta del espacio monitorizado con la posición de sus tres nodos.

```bash
mysql -h <host> -u <usuario> -p bdproyectodegrado < bd/database.sql
```

## No borra nada

Cada tabla se crea **solo si no existe**, y el alta del espacio actualiza sus
propias filas sin tocar ninguna otra. Ejecutarlo sobre una base en uso es
inofensivo: las cuentas, los correos autorizados y las detecciones ya capturadas
se quedan como están. Se puede repetir las veces que haga falta.

**La contrapartida**: si una tabla ya existe con una estructura antigua, el
archivo no la actualiza — la encuentra y la deja intacta. Cambiar una tabla que
ya tiene datos exige un `ALTER TABLE` escrito para ese cambio concreto, que
renombre o añada columnas en lugar de recrear la tabla.

## Regla importante: `DB_SYNCHRONIZE` va en `false`

La sincronización automática de TypeORM **no sabe renombrar**. Ante un nombre de
columna distinto al que hay en la base, elimina la vieja y crea otra vacía: el
contenido se pierde sin aviso y sin posibilidad de deshacerlo.

Con el esquema fijado en `database.sql`, dejarla activa no aporta nada y sí puede
destruir datos. Debe estar en `false` **también en el entorno de despliegue**, no
solo en local.

## El espacio monitorizado

Al final del archivo se da de alta la plazoleta del despliegue: un rectángulo de
21 m × 11,84 m con los nodos formando un triángulo isósceles: dos en las
esquinas de un lado largo y el tercero en el centro del lado opuesto. El origen
de coordenadas está en la esquina del nodo 1, con X hacia la derecha e Y hacia
arriba, en metros.

```
                       (10.5, 11.84)
                          nodo 3
           ┌──────────────┴──────────────┐
           │                             │  11,84 m
           │                             │
  nodo 1   └─────────────────────────────┘  nodo 2
 (0, 0)                21 m                (21, 0)
```

### Por qué esta disposición y no tres esquinas

Montar los tres nodos en tres esquinas deja el triángulo apoyado en una diagonal:
la geometría es asimétrica y la mitad de la plaza más alejada del tercer nodo
recibe peor cobertura. El triángulo isósceles cubre el mismo área —ambas
disposiciones encierran 124,3 m²— pero es simétrico respecto al eje vertical, así
que el error no favorece a ninguna mitad.

La diferencia se midió simulando 10 000 posiciones repartidas por la plaza con
ruido gaussiano sobre cada distancia:

| Ruido por distancia | Disposición | Error medio | Error p95 | Sin posición |
| --- | --- | --- | --- | --- |
| σ = 0,5 m | tres esquinas | 0,80 m | 1,88 m | 0,3 % |
| | **triángulo** | **0,65 m** | **1,37 m** | **0,0 %** |
| σ = 1,5 m | tres esquinas | 2,19 m | 5,02 m | 7,5 % |
| | **triángulo** | **1,87 m** | **3,87 m** | **4,1 %** |
| σ = 3,0 m | tres esquinas | 3,77 m | 8,17 m | 22,9 % |
| | **triángulo** | **3,41 m** | **6,95 m** | **15,7 %** |

El error medio mejora entre un 10 % y un 19 %, pero lo que más cambia es la
proporción de dispositivos que quedan **sin posición**: entre un tercio y casi la
mitad menos. Con RSSI sin calibrar el ruido real está más cerca de σ = 3 m que de
σ = 0,5 m, así que es en esa fila donde se nota en el mapa.

### Corrección vertical

Con dos nodos en un lado y uno solo en el opuesto, la trilateración por RSSI
sitúa los dispositivos más cerca del lado de los dos nodos. Un portátil quieto
en el centro del triángulo, (10,5; 3,95), aparecía de media en (10,9; 1,2): 2,8 m
por debajo, en 8 ventanas de 2 minutos.

Se probaron dos correcciones sobre esas mediciones:

| Corrección | Posición media del portátil | Error medio |
| --- | --- | --- |
| ninguna | (10,9; 1,2) | 2,8 m |
| Nodo 3 +6 dB | (10,9; 2,1) | 2,0 m |
| subir +2 m | (10,9; 2,9) | 1,4 m |
| **subir +2,5 m** | **(10,9; 3,4)** | **1,2 m** |
| subir +3 m | (10,9; 3,9) | 1,2 m |

Corregir la señal del Nodo 3 apenas mueve las posiciones, así que se desplaza
el resultado. Se toma +2,5 m y no +3, que clava justo el portátil, para no
ajustar la corrección a un único dispositivo. Se declara por zona en
`coordenadas.ajusteVerticalM` porque depende de cómo está montado cada espacio.

Es una corrección empírica con una sola referencia fiable: un dispositivo que
esté de verdad junto al lado de los nodos 1 y 2 aparecerá más arriba de lo que
está. Conviene revisarla con más puntos de referencia.

## Qué cuenta como dispositivo presente

Los nodos oyen mucho más que la plazoleta. Una medición nocturna registró 633
dispositivos distintos en 10 minutos, con la mediana de la mejor señal en
−82 dBm: la mayoría estaba en otros pisos o fuera del edificio. Entre lo que sí
llegaba con fuerza desde dentro, 11 de 15 eran los BSSID de los dos puntos de
acceso de la universidad (UNBOSQUE, UEB_Tita y VIP en cada aparato), otro era la
Wi-Fi de un nodo y otro el hotspot del despliegue.

Por eso el mapa, la ocupación consolidada y el panel no cuentan detecciones
sino **dispositivos presentes**, con un único criterio (`presencia.ts`):

1. **No es infraestructura.** Se clasifica al ingerir, con la MAC en claro, y
   se guarda en `dispositivo_infraestructura` por su hash:
   - *Punto de acceso*: dos o más MAC de la misma lectura que comparten los 11
     primeros dígitos y llegan con menos de 6 dB de diferencia. Son las redes
     de un mismo aparato.
   - *Junto a un nodo*: señal de −35 dBm o más, a menos de un metro de la
     antena. Es equipamiento del despliegue.
   - *Manual*: excluido con `npm run dispositivo:excluir`.

   Las marcas automáticas caducan a las 24 h sin reconfirmarse
   (`INFRAESTRUCTURA_VIGENCIA_HORAS`); las manuales, no.

2. **Lo oyen bien todos los nodos que emitieron en la ventana.** El criterio es
   el nodo que *peor* lo oye, que debe superar `PRESENCIA_RSSI_MINIMO_DBM`
   (−75 por defecto). Quien está en la plazoleta está a línea de vista de los
   tres; lo que está tras una pared lo oye fuerte un solo nodo, y lo que está en
   otro piso lo oyen todos atenuado. La señal más fuerte no separa esos casos;
   la más débil, sí.

Sobre los 517 dispositivos captados en una ventana de 5 minutos, con 181
identificados como infraestructura, el umbral decide cuántos quedan:

| Umbral | Presentes | Qué cambia |
| --- | --- | --- |
| −72 dBm | 3 | se pierde un portátil que está dentro |
| **−75 dBm** | **4** | **conserva el portátil; no entra ningún router conocido de fuera** |
| −76 dBm | 5 | entra el router doméstico de un vecino |
| −78 dBm | 7 | entran dos dispositivos más sin identificar |
| −85 dBm | 24 | entran varios routers vecinos más |

El margen es estrecho: el router vecino llega con −76 dBm en el nodo que peor
lo oye, a 1 dB del corte.

Es un compromiso y no una frontera: un teléfono en el bolsillo en la esquina
más alejada llega más débil que un portátil, y un router lejano emite más fuerte
que un teléfono cercano. La medición se hizo de noche, con la plazoleta casi
vacía; conviene recalibrarlo con gente, recorriendo el espacio con un teléfono y
`npm run dispositivo:medir`.

Los routers de una sola red, como el del vecino, no se pueden reconocer como
punto de acceso con lo que envía hoy el productor: Kismet sí distingue puntos
de acceso de clientes, pero `sniffer.py` reduce ese tipo a `PROBING` o
`ASSOCIATED` antes de publicarlo.

`id_sensor` debe coincidir con el `sensor_id` que cada Raspberry publica en
Kafka. Los nodos se auto-registran al enviar su primera lectura, así que si ya
aparecieron con otro identificador, ajusta los del archivo en lugar de crear
duplicados: dos filas para el mismo nodo partirían sus detecciones en dos.

## Correspondencia con el Anexo 13

El esquema sigue el modelo relacional del documento. El diagrama usa notación de
PostgreSQL; aquí se traduce a MySQL:

| Diagrama | MySQL |
|---|---|
| `BIGSERIAL` | `BIGINT UNSIGNED AUTO_INCREMENT` |
| `JSONB` | `JSON` |
| `TIMESTAMP` | `DATETIME` |

Hay tres desviaciones deliberadas:

1. **`ADMIN` y `CORREO_PERMITIDO` conservan clave primaria entera**, no UUID. El
   sistema ya está en explotación con cuentas y sesiones que las referencian. Las
   tablas del subsistema de sensado, que nacen vacías, sí usan UUID como indica
   el modelo.

2. **`username` y `email` son `TEXT`**, no `VARCHAR`: van cifrados con
   AES-256-GCM y el texto cifrado no cabe en la longitud del modelo. Cada uno
   lleva una columna `*_hash` con el HMAC-SHA256 del valor normalizado, que es lo
   que permite buscar por igualdad sin descifrar.

3. **`REGISTRO_PENDIENTE` no está en el diagrama**, pero el alta de
   administradores es un flujo en dos pasos y su estado intermedio tiene que
   persistir en algún sitio.

Y una relación del diagrama que **no** se declara: `ADMIN.email` como clave
foránea hacia `CORREO_PERMITIDO.email`. La lista blanca gobierna quién *puede
iniciar* el registro, no quién sigue siendo administrador; con esa restricción
sería imposible retirar un correo de la lista sin borrar antes su cuenta. La
comprobación vive en `AuthService.register`.

## Nombres: base de datos frente a código

Las tablas y columnas siguen el `snake_case` en español del modelo. Las
propiedades TypeScript de las entidades se mantienen en `camelCase`, y la
correspondencia se declara con `name:` en cada decorador de columna:

```ts
@Column({ name: 'capacidad_max', type: 'int', unsigned: true, nullable: true })
capacidadMax: number | null;
```

Gracias a eso, ningún servicio ni repositorio conoce los nombres de la base.

Por el mismo motivo, las consultas construidas a mano deben referenciar las
tablas **por su clase de entidad** y no por su nombre en texto. Con una clase,
TypeORM traduce cada propiedad a su columna real; con un nombre en texto no hay
metadatos que consultar y la consulta se rompe al renombrar cualquier columna.
