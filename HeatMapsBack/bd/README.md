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
17,64 m × 9,10 m con los nodos formando un triángulo isósceles: dos en las
esquinas inferiores y el tercero en el centro del borde superior. El origen de
coordenadas está en la inferior izquierda, con X hacia la derecha e Y hacia
arriba, en metros.

```
                       (8.82, 9.10)
                          nodo 3
           ┌──────────────┴──────────────┐
           │                             │
           │                             │
  nodo 1   └─────────────────────────────┘  nodo 2
 (0, 0)                                    (17.64, 0)
```

### Por qué esta disposición y no tres esquinas

Montar los tres nodos en tres esquinas deja el triángulo apoyado en una diagonal:
la geometría es asimétrica y la mitad de la plaza más alejada del tercer nodo
recibe peor cobertura. El triángulo isósceles cubre el mismo área —ambas
disposiciones encierran 80,3 m²— pero es simétrico respecto al eje vertical, así
que el error no favorece a ninguna mitad.

La diferencia se midió simulando 10 000 posiciones repartidas por la plaza con
ruido gaussiano sobre cada distancia:

| Ruido por distancia | Disposición | Error medio | Error p95 | Sin posición |
| --- | --- | --- | --- | --- |
| σ = 0,5 m | tres esquinas | 0,83 m | 1,99 m | 0,4 % |
| | **triángulo** | **0,67 m** | **1,42 m** | **0,0 %** |
| σ = 1,5 m | tres esquinas | 2,20 m | 5,06 m | 10,0 % |
| | **triángulo** | **1,88 m** | **3,89 m** | **5,3 %** |
| σ = 3,0 m | tres esquinas | 3,52 m | 7,42 m | 29,1 % |
| | **triángulo** | **3,34 m** | **6,86 m** | **19,5 %** |

El error medio mejora entre un 5 % y un 19 %, pero lo que más cambia es la
proporción de dispositivos que quedan **sin posición**: casi la mitad. Con RSSI
sin calibrar el ruido real está más cerca de σ = 3 m que de σ = 0,5 m, así que es
en esa fila donde se nota en el mapa.

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
