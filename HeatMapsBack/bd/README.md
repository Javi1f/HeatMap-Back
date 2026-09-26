# Base de datos

Esquema relacional del sistema, sobre **MySQL 8**.

## Un solo archivo

`database.sql` contiene todo lo necesario: la estructura de las doce tablas (las
nueve entidades del Anexo 13 y tres de apoyo) y el alta del espacio monitorizado
con la posición de sus tres nodos.

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

## Comprobar y migrar el esquema

Las entidades TypeORM reflejan `database.sql` columna a columna, con los mismos
nombres de índice, clave foránea y restricción. Dos comandos lo mantienen así:

| Comando | Qué hace |
|---|---|
| `npm run bd:deriva` | Pregunta a TypeORM qué cambiaría para igualar la base con las entidades y lo lista, **sin ejecutar nada**. Termina con código 1 si hay diferencias: sirve como comprobación antes de desplegar. |
| `npm run bd:migrar` | Muestra el plan para llevar una base antigua al esquema actual. Con `-- --aplicar` lo ejecuta. |

`bd:migrar` trabaja en dos fases:

- **A. Identificadores UUID.** Si `admin.id_admin` todavía es un entero, asigna
  un UUID a cada cuenta y a cada correo permitido y reescribe todas las columnas
  que los referencian (`sesion_auth`, `sensor.registrado_por`, `reporte`,
  `evento_auditoria`). `correo_permitido.anadido_por` y `alerta.resuelta_por`,
  que guardaban el nombre en texto, pasan a ser claves foráneas hacia `admin`:
  el script descifra los nombres en memoria para encontrar la cuenta, y deja
  `NULL` cuando ya no existe. Esta parte no puede ser un `.sql` fijo: depende
  de los datos y de la clave de cifrado.
- **B. Índices y restricciones.** Renombra los índices con nombre autogenerado
  (`IDX_…`) al nombre del DDL —solo cambia metadatos— y aplica las claves
  foráneas, índices y restricciones que falten. Si el plan tocara columnas de
  cualquier otra forma, se detiene sin ejecutar nada.

Es idempotente: sobre una base ya migrada no hace nada. Tras aplicarlo:

1. `npm run bd:deriva` debe responder «Sin deriva».
2. Hay que redesplegar el backend **enseguida**: el código anterior espera ids
   enteros.
3. Las sesiones abiertas dejan de valer (el token llevaba el id entero): cada
   administrador vuelve a iniciar sesión.

Lo que `bd:migrar` no cambia es la **colación** de las tablas que creó la
sincronización automática (`utf8mb4_0900_ai_ci`, frente a `utf8mb4_unicode_ci`
del DDL). No afecta a ninguna consulta —las columnas cifradas y los hash no se
comparan por idioma— y convertir `captura` reescribiría la tabla entera. Las
columnas nuevas de la fase A se crean con la colación de `admin` para que las
claves foráneas sean válidas.

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

La diferencia se midió simulando 2 000 posiciones repartidas por la plaza, con
ruido uniforme en la señal de cada nodo y el posicionador actual:

| Ruido de señal | Disposición | Error medio | Error p95 | Sin posición |
| --- | --- | --- | --- | --- |
| ±2 dB | tres esquinas | 2,71 m | 6,23 m | 0,0 % |
| | triángulo | 3,27 m | 7,97 m | 0,0 % |
| ±4 dB | tres esquinas | 3,63 m | 8,08 m | 0,0 % |
| | triángulo | 3,62 m | 8,60 m | 0,0 % |
| ±6 dB | tres esquinas | 4,41 m | 9,59 m | 0,0 % |
| | triángulo | 4,17 m | 9,62 m | 0,0 % |

Con el posicionador anterior el triángulo mejoraba el error entre un 10 % y un
19 % y dejaba muchos menos dispositivos sin posición. Con el actual la diferencia
entre las dos disposiciones **se pierde en el ruido** —±0,6 m arriba o abajo
según el nivel de ruido— y ninguna deja dispositivos sin situar: la búsqueda está
acotada al rectángulo, así que siempre hay solución.

Lo que sigue sosteniendo la elección es la **simetría**: el triángulo isósceles
reparte el error igual entre las dos mitades de la plaza, mientras que con los
nodos en tres esquinas la mitad más alejada del tercero queda siempre peor
cubierta. Esa asimetría no se ve en el error medio de toda la plaza, que es lo
que mide la tabla.

### Por qué el mapa amontonaba todo en el centro

Durante las primeras pruebas el mapa ponía a casi todos los dispositivos en una
mancha central, estuvieran donde estuvieran. No era un error de las medidas: era
el método de posicionamiento.

La trilateración clásica linealiza las circunferencias restando sus ecuaciones,
y lo que queda es un sistema en las **diferencias de distancias al cuadrado**. Si
el modelo de propagación devuelve distancias demasiado cortas —y las devuelve en
cuanto `RSSI_REFERENCE_DBM` o `PATH_LOSS_EXPONENT` no están calibrados para el
espacio—, esas diferencias se encogen todas a la vez y la solución tiende al
punto equidistante de los tres nodos, que en esta disposición cae en el centro de
la plaza. Con la referencia por defecto (−40 dBm, n = 3) un dispositivo medido a
−68 dBm salía a 8,6 m cuando estaba a 21 m: un factor 0,4 sobre todas las
distancias, suficiente para colapsar el mapa.

La corrección vertical de 2,5 m que se aplicaba por zona
(`coordenadas.ajusteVerticalM`) era un parche de ese mismo sesgo, y **ya no se
aplica**: el sesgo no era un desplazamiento hacia abajo sino una atracción hacia
el centro, así que desplazar el resultado arreglaba una zona de la plaza y
empeoraba las demás.

### Ajuste por razones de distancia

El posicionador actual (`positioning.service.ts`) no busca el punto que cumple
las distancias, sino el que las cumple **en proporción**: minimiza la dispersión
de los logaritmos de `distancia medida / distancia geométrica` sobre el
rectángulo de la zona. Un error de escala común desaparece de ese criterio, así
que el nivel de referencia del modelo deja de mover el mapa. Como subproducto, el
factor de escala que sí se estima dice cuánto se desvía el modelo: su mediana por
ventana se publica en el mapa (`desajusteReferenciaDb`) y se registra en el log,
y es directamente los dB que hay que restar a `RSSI_REFERENCE_DBM`.

Comparación sobre 15 posiciones simuladas con el entorno real de la plaza
(referencia −28 dBm, n = 2,1), señales con ±1,5 dB de ruido y el modelo sin
calibrar:

| Método | Error medio | Qué se ve en el mapa |
| --- | --- | --- |
| trilateración lineal + corrección de 2,5 m | 6,9 m | las 15 posiciones en tres celdas del centro |
| **razones de distancia** | **2,5 m** | **los dos grupos, cada uno en su sitio** |
| razones de distancia, con `PATH_LOSS_EXPONENT` = 2,1 | 1,8 m | igual, más concentrado |

El exponente sigue importando —cambia el contraste de las razones— pero el
error que introduce es de decenas de centímetros, no de metros. En un espacio
abierto con línea de vista está entre 2,0 y 2,2.

**Calibración medida (26-09-2026).** Un portátil en cuatro puntos conocidos —
pegado a cada nodo y en el borde sur— dio −26 a −30 dBm en el nodo pegado y
entre −48 y −56 dBm en los demás, a 8–21 m. Con esas medidas:

| Exponente | Error medio | Error máximo |
| --- | --- | --- |
| literatura (n = 3) | 1,70 m | 2,7 m |
| **calibrado (n = 2)** | **1,29 m** | **1,8 m** |

La referencia a un metro no cambia la posición —el posicionador no usa la
escala—, pero sí las distancias guardadas. El portátil dio −28,6 dBm, y un
teléfono emite unos 11 dB menos (el iPhone del despliegue, −41; el desajuste
medido sobre los dispositivos presentes, 10,7 dB), así que se deja en
**−40 dBm**, la del aparato típico.

Como comprobación, un punto que no se usó para ajustar —el centro de la plaza—
salió a 1,6 m con la pantalla del portátil hacia el nodo más cercano. Con la
persona entre el portátil y ese nodo, el mismo punto salió a 5,5 m: girar el
aparato movió 8 dB la señal de otro nodo. El cuerpo y la orientación pesan más
que cualquier ajuste del modelo, y son la razón de que en uso real el error sea
de unos metros.

Más allá de unos 8 m la señal apenas cambia con la distancia, así que la
posición es más fiable cerca de un nodo que en medio de la plaza. Una lectura
junto a un nodo debe hacerse con el aparato pegado a la antena: con el cuerpo
del nodo en medio, la misma posición dio −46 dBm en lugar de −30.

### Con personas alrededor

Lo que estropea la posición no es el ruido de trama a trama: con el aparato
quieto, sus tramas varían de 0,3 a 2,5 dB. Es un **sesgo estable por enlace**,
de unos ±4 dB medidos, que ponen la orientación de la antena, los rebotes y
los cuerpos. Una persona entre el aparato y un nodo le quita a ese enlace
entre 5 y 15 dB; quien pasa por delante, lo mismo pero sólo durante unas
tramas. Y girar el aparato puede subir un enlace tanto como bajarlo: en el
centro de la plaza, girar el portátil movió 8 dB la señal de un nodo.

Con tres nodos no se puede saber qué enlace miente —siempre hay un punto que
explica las tres señales a la vez—, así que el sistema no intenta adivinarlo:

1. **Percentil 75 de cada enlace**, no la media (`senalesDeNodosSituados`). Quien
   pasa sólo resta, y el percentil alto ignora esa caída mientras afecte a
   menos de una cuarta parte de las tramas del último minuto.
2. **Media de las posiciones compatibles**, no la más compatible
   (`PositioningService`). Cada punto de la plaza pesa según lo bien que
   explica las señales con un error de 4 dB por enlace; el punto de coste
   mínimo, el que se usaba antes, es el más probable de esa distribución. Cuando
   un enlace llega tapado, ese máximo salta al punto que justifica el error,
   a veces a muchos metros; la media apenas se mueve. Cada estimación dice
   además cuánto duda (`incertidumbreM`).

Evaluado de dos formas. Primero, sobre las tramas reales de un portátil en siete
tramos de posición conocida (ventanas de un minuto), con personas simuladas
encima:

| Escenario | Error medio antes → ahora | Peor 10 % antes → ahora |
| --- | --- | --- |
| sin nadie | 2,17 → 2,18 m | 5,5 → 5,1 m |
| personas quietas tapando enlaces | 3,06 → 2,66 m | 7,1 → 5,6 m |
| gente de paso | 2,64 → 2,19 m | 7,1 → 4,9 m |
| todo junto, más orientación | 3,51 → 2,99 m | 8,0 → 6,1 m |

Y, como esos tramos están casi todos junto a un nodo, sobre toda la plaza: una
rejilla de posiciones con el error medido en campo (±4 dB por enlace y un
desfase común de ±4 dB por aparato):

| Escenario | Error medio antes → ahora | Peor 10 % antes → ahora |
| --- | --- | --- |
| sin nadie | 4,38 → 3,82 m | 8,3 → 6,5 m |
| con personas | 5,62 → 4,82 m | 10,7 → 8,8 m |

El precio es un sesgo hacia dentro en lo más alejado de los nodos: en la
esquina sin nodo, con medidas perfectas, la media queda metros hacia el
centro. En la plaza real las medidas nunca son perfectas y, contando toda la
plaza, compensa. **Con tres nodos el error típico es de unos 4 m**, y más en
los bordes; es el límite de la señal, no del método. Más nodos sí lo bajan
(misma simulación, con personas): cuatro en las esquinas, 4,1 m; los tres
actuales más las dos esquinas superiores, 3,7 m.

### Una mancha por dispositivo

Cada dispositivo presente cuenta **una vez**, en la celda de medio metro donde
cae su posición estimada, y la interfaz dibuja una mancha de unos 1,6 m de radio
alrededor de cada celda ocupada, más intensa cuantos más dispositivos coinciden.
El tamaño de la mancha es el que expresa que la posición tiene un error de
metros; el servidor no reparte nada.

| Lo oyen | Dónde se cuenta |
| --- | --- |
| un nodo | junto a ese nodo (sólo pasa si hay un único nodo activo: con dos o más, la presencia exige que lo oigan dos) |
| dos o más | en la media de las posiciones compatibles con sus señales (ver arriba); con dos, lo compatible es un arco y la media queda dentro de él |

Una posición en el margen exterior que tolera el posicionador se pega al borde
para que siga contando. Si el posicionador no halla solución, el dispositivo
pasa a `sinPosicion`.

El límite de tres nodos que oyen igual sigue ahí: en el plano sólo lo cumple el
punto equidistante, pero también algo en otro piso justo encima o debajo, o algo
muy lejos. Distinguirlos exige la intensidad **absoluta**, es decir, calibrar
`RSSI_REFERENCE_DBM` con medidas en puntos conocidos.

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
     antena, **durante al menos una hora seguida**
     (`INFRAESTRUCTURA_PERMANENCIA_MINUTOS`). Es equipamiento del despliegue:
     la Wi-Fi de la Raspberry o el hotspot, que están ahí horas.
   - *Manual*: excluido con `npm run dispositivo:excluir`.

   Las marcas automáticas caducan a las 24 h sin reconfirmarse
   (`INFRAESTRUCTURA_VIGENCIA_HORAS`); las manuales, no.

   La permanencia se añadió porque la regla original marcaba con una sola
   lectura fuerte, y eso excluía durante un día entero a cualquiera que pasara
   junto a un nodo: el portátil con el que se calibró quedó fuera del mapa todo
   el día por haberlo acercado a dos nodos. Para medirla, `primera_deteccion`
   guarda el **inicio de la racha actual** y no la primera vez que se vio: se
   reinicia si pasan más de 20 minutos sin reconfirmarse. Así
   `ultima_deteccion − primera_deteccion` es el tiempo que lleva cumpliendo la
   regla seguido.

2. **Lo oyen al menos dos nodos** (`PRESENCIA_NODOS_MINIMOS`; nunca se exigen
   más de los que emitieron en la ventana). Lo que está tras la pared de una
   esquina lo oye el nodo de esa esquina y apenas los otros.
3. **El nodo que mejor lo oye lo oye fuerte**, a `PRESENCIA_RSSI_MEJOR_MINIMO_DBM`
   o más (−60 por defecto). Ningún punto de la plazoleta está a más de unos
   10,6 m de su nodo más cercano, así que quien está dentro tiene siempre uno
   que lo oye bien. Lo que llega igual de débil a todos está lejos de todos: en
   la sala de al lado o en otro piso.
4. **Ninguno lo oye atenuado**: el nodo que *peor* lo oye debe superar
   `PRESENCIA_RSSI_MINIMO_DBM` (−75 por defecto). Lo que está en otro piso lo
   oyen todos, pero atenuado por el forjado.

La condición 3 se añadió con una **verdad de referencia**: tres dispositivos
conocidos dentro de la sala y todo lo demás fuera, en una ventana de 10 minutos
con 3.721 dispositivos oídos.

| Criterio | Reales que conserva | De fuera que deja pasar |
| --- | --- | --- |
| condiciones 2 y 4, más aceptar lo que un solo nodo oye a −65 o más | 3 de 3 | 121 |
| **condiciones 2, 3 y 4** | **3 de 3** | **4** |

Los tres reales los oyeron los tres nodos, con decenas de tramas cada uno, y el
nodo que mejor los oía estaba entre −56 y −46 dBm. De los cuatro de fuera que
quedan, dos son equipamiento pegado a un nodo (a −21 y −27 dBm), que corresponde
a la regla de infraestructura. La regla de «un solo nodo muy fuerte» que se
probó antes fue un error: de los que oía un solo nodo, ninguno estaba dentro.
Con tres dispositivos la muestra es pequeña; conviene repetir la prueba con más,
y en especial con algo de poca potencia —un reloj, un teléfono en reposo— en el
centro, que es lo que primero perdería la condición 3.

**Los teléfonos tienen 3 dB de margen en las condiciones 3 y 4**
(`PRESENCIA_AJUSTE_MAC_ALEATORIA_DB`). Es lo que la advertencia anterior
temía: un teléfono emite unos 12 dB menos que un portátil, y quien lo lleva tapa
con el cuerpo algún enlace. Con las lecturas reales de un portátil en
posiciones conocidas, llevadas al nivel de un teléfono:

| Umbrales para MAC aleatoria | Teléfono presente | Con el cuerpo tapando un nodo | De fuera que se cuelan (2 h) |
| --- | --- | --- | --- |
| −60 / −75, como el resto | 65 % | 49 % | 1 persistente, 9 esporádicos |
| **−63 / −78** | **91 %** | **69 %** | **2 persistentes, 12 esporádicos** |
| −66 / −81 | 100 % | 89 % | 4 persistentes, 25 esporádicos |

Se reconoce a los teléfonos por la MAC aleatoria, que es la que usan por
defecto; los equipos fijos de las oficinas de alrededor suelen llevar la de
fábrica y emitir más fuerte, así que a ellos no se les rebaja nada. No se baja
más porque los teléfonos de esas oficinas también tienen MAC aleatoria: con
6 dB ya entraban tres persistentes de fuera.

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

1. **Los UUID son `CHAR(36)`** asignados por la aplicación al insertar
   (`nuevoUuid()` en `src/persistencia/entidades/uuid.ts`). MySQL no tiene un
   tipo UUID nativo. Todas las tablas del modelo usan UUID como indica el
   diagrama, incluidas `ADMIN` y `CORREO_PERMITIDO`; `CAPTURA` y
   `OCUPACION_AGREGADA` conservan su `BIGINT` autoincremental.

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
