# Arquitectura del backend

Node.js + Express + TypeORM sobre MySQL 8. Expone una API REST y un canal
Socket.IO al frontend Angular, y consume de Kafka las lecturas de los nodos de
captura. Esta guía relaciona las carpetas de `src/` con los componentes y el
flujo del documento (Anexos 10, 12 y 13).

## Carpetas

| Carpeta | Contenido |
|---|---|
| `modules/identidad/` | Componente de identidad y autenticación: `autenticacion` (login, registro, sesiones, JWT, `authMiddleware`), `correos-permitidos` (lista blanca), `usuarios` (cuentas, roles, `requireRoot`, auditoría). |
| `modules/mailer/` | Envío de correos de verificación. |
| `modules/ingesta/` | Consumidor Kafka, validación de lecturas (RF-12), filtrado de MAC (RF-11) y guardado. |
| `modules/anonimizacion/` | HMAC-SHA256 de la MAC antes de persistirla. |
| `modules/procesamiento/` | Presencia, estimación de distancia, triangulación, mapa de calor y agregado de ocupación. |
| `modules/historicos/` | Consultas para el panel (`metricas`), la vista pública (`publico`) y los reportes CSV (`reportes`). |
| `modules/tiempo-real/` | Emisión por Socket.IO. |
| `persistencia/entidades/` | Entidades TypeORM, reflejo exacto de `bd/database.sql`. |
| `persistencia/repositorios/` | Único acceso a la base desde los servicios. |
| `crypto/` | Componente Cryptography: AES-256-GCM de la API y de los campos de la base, descifrado de Kafka y el middleware que cifra peticiones y respuestas. |
| `config/` | Conexiones (base, Kafka, correo, Socket.IO) y parámetros de sensado. |
| `common/` | Piezas sin dominio: entorno validado, errores, logger, middlewares HTTP genéricos, utilidades (incluida la forma canónica de una MAC). |
| `types/` | Contratos que cruzan módulos: el JWT y la lectura de un sensor. |
| `scripts/` | Comandos de operación (`npm run …`): respaldo, deriva y migración del esquema, calibración. |

## Reglas de dependencia

- `modules/*` → `persistencia/repositorios` → `persistencia/entidades`.
  Ningún servicio usa `DataSource` ni `getRepository` directamente.
- `persistencia`, `crypto`, `config` y `common` no importan nada de `modules/`.
- Las rutas HTTP solo validan (DTO con zod), llaman a un servicio y responden.
  Las reglas de negocio —por ejemplo, que el correo fundador no se puede
  borrar— viven en el servicio, no en el frontend.

## Flujo de una lectura (Anexo 10)

```
Kafka ─▶ KafkaConsumerService.leer
           ├─ descifra el sobre
           └─ validarLectura         estructura, rangos, trama (RF-12)
         ─▶ ¿caducada? se descarta
         ─▶ DataProcessorService.processAndSave
           ├─ filtrarMacs            mal formadas, de grupo, duplicadas (RF-11)
           ├─ MacAnonymizerService   la MAC nunca se guarda en claro
           └─ CapturaRepository      persistencia
         ─▶ SocketEmitterService     resumen sin identificadores
```

El procesamiento (presencia, posición, mapa de calor, ocupación) trabaja sobre
lo ya guardado, en `modules/procesamiento/`.

Al unirse al grupo de consumidores, el backend salta los mensajes más antiguos
que la ventana de vigencia, para no reprocesar una cola atrasada al arrancar.

## Modelo de datos

Ver `bd/README.md`: correspondencia con el Anexo 13, identificadores UUID,
y los comandos `bd:deriva` y `bd:migrar`.
