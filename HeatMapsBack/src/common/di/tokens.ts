/**
 * Tokens de inyección de dependencias.
 *
 * Cuando necesitas inyectar una interface o un valor primitivo, usa un token
 * (las interfaces no existen en runtime). Para clases concretas, usa la clase
 * directamente como token.
 *
 * Convenciones:
 *  - PascalCase con sufijo `Token`.
 *  - Un símbolo único por token, exportado para inyección y registro.
 */

/** `DataSource` de TypeORM ya inicializado. */
export const DataSourceToken = Symbol('DataSource');

/** Implementacion de `ILogger`. */
export const LoggerToken = Symbol('Logger');

/** Servidor de Socket.IO montado sobre el servidor HTTP. */
export const SocketServerToken = Symbol('SocketServer');

/** Cliente de KafkaJS configurado con TLS. */
export const KafkaClientToken = Symbol('KafkaClient');

/** Transporte de Nodemailer para el envio de correos. */
export const MailTransporterToken = Symbol('MailTransporter');
