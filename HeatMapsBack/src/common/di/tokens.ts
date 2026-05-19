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

export const DataSourceToken = Symbol('DataSource');
export const LoggerToken = Symbol('Logger');
export const SocketServerToken = Symbol('SocketServer');
export const KafkaClientToken = Symbol('KafkaClient');
export const MailTransporterToken = Symbol('MailTransporter');
