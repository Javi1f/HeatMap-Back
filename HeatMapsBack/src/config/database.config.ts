import { singleton } from 'tsyringe';
import { DataSource } from 'typeorm';
import { Admin } from '../models/Admin.entity';
import { AllowedEmail } from '../models/AllowedEmail.entity';
import { PendingRegistration } from '../models/PendingRegistration.entity';
import { SesionAuth } from '../models/SesionAuth.entity';
import { Zona } from '../models/Zona.entity';
import { Sensor } from '../models/Sensor.entity';
import { Captura } from '../models/Captura.entity';
import { OcupacionAgregada } from '../models/OcupacionAgregada.entity';
import { Alerta } from '../models/Alerta.entity';
import { Reporte } from '../models/Reporte.entity';
import { EnvService } from '../common/env/env.service';

/**
 * Fábrica/wrapper del `DataSource` de TypeORM.
 *
 * Reemplaza el anti-patrón de exportar un singleton global `AppDataSource`
 * que cualquier archivo podía importar. Ahora el `DataSource` se crea con
 * configuración inyectada y se obtiene únicamente a través del contenedor DI.
 *
 * Los servicios de dominio NO deben usar este objeto directamente: deben
 * recibir un repositorio (`Repository<Entity>`) a través de su provider en
 * `src/common/di/container.ts`.
 *
 * **`DB_SYNCHRONIZE` debe permanecer en `false`.** La sincronización automática
 * no sabe renombrar: ante un nombre de columna distinto al que hay en la base,
 * elimina la vieja y crea otra vacía, perdiendo su contenido sin aviso. El
 * esquema lo define `bd/database.sql` y los cambios se aplican con los archivos
 * de migración de esa misma carpeta.
 */
@singleton()
export class DatabaseConfig {
    /** Conexion de TypeORM. Se obtiene solo a traves del contenedor DI. */
    public readonly dataSource: DataSource;

    constructor(env: EnvService) {
        this.dataSource = new DataSource({
            type: 'mysql',
            host: env.get('DB_HOST'),
            port: env.get('DB_PORT'),
            username: env.get('DB_USERNAME'),
            password: env.get('DB_PASSWORD'),
            database: env.get('DB_DATABASE'),
            synchronize: env.get('DB_SYNCHRONIZE'),
            logging: env.get('DB_LOGGING'),
            entities: [
                Admin,
                AllowedEmail,
                PendingRegistration,
                SesionAuth,
                Zona,
                Sensor,
                Captura,
                OcupacionAgregada,
                Alerta,
                Reporte,
            ],
            migrations: [],
            subscribers: [],
            charset: 'utf8mb4',
            timezone: 'Z',
        });
    }

    /**
     * Inicializa la conexión. Idempotente: si ya está inicializada, no hace nada.
     */
    async initialize(): Promise<void> {
        if (!this.dataSource.isInitialized) {
            await this.dataSource.initialize();
        }
    }

    /**
     * Cierra la conexión. Idempotente.
     */
    async destroy(): Promise<void> {
        if (this.dataSource.isInitialized) {
            await this.dataSource.destroy();
        }
    }
}
