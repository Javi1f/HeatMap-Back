import { injectable } from 'tsyringe';
import { Repository } from 'typeorm';
import { Sensor } from '../../../models/Sensor.entity';
import { DatabaseConfig } from '../../../config/database.config';

/**
 * Acceso a los nodos de captura registrados.
 */
@injectable()
export class SensorRepository {
    /** Repositorio TypeORM de la entidad gestionada. */
    private readonly repo: Repository<Sensor>;

    constructor(db: DatabaseConfig) {
        this.repo = db.dataSource.getRepository(Sensor);
    }

    /** Todos los nodos con su zona resuelta, ordenados por identificador. */
    findAll(): Promise<Sensor[]> {
        return this.repo.find({ relations: { zona: true }, order: { idSensor: 'ASC' } });
    }

    /** Busca un nodo por el identificador que publica en Kafka. */
    findById(idSensor: string): Promise<Sensor | null> {
        return this.repo.findOne({ where: { idSensor } });
    }

    /**
     * Registra un nodo que aún no existía, asociándolo a la zona indicada.
     */
    create(idSensor: string, idZona: string): Promise<Sensor> {
        return this.repo.save(
            this.repo.create({
                idSensor,
                nombre: idSensor,
                idZona,
                estado: 'activo',
            }),
        );
    }

    /**
     * Marca que el nodo acaba de emitir. Se llama en cada lectura recibida, de
     * ahí que use `update` directo en lugar de cargar la entidad.
     */
    async touch(idSensor: string, at: Date): Promise<void> {
        await this.repo.update({ idSensor }, { ultimaConexion: at, estado: 'activo' });
    }
}
