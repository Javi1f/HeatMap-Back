import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Admin } from './Admin.entity';
import { Zona } from './Zona.entity';

/**
 * Consulta consolidada que un responsable institucional genera y conserva.
 *
 * Guarda la definición del reporte, no su resultado: el rango, la zona y los
 * filtros con los que se pidió. Los datos se recalculan al abrirlo, de modo
 * que un mismo reporte refleja siempre el estado actual de la información en
 * lugar de una foto congelada que envejece.
 *
 * La entidad existe en el modelo relacional del Anexo 13 y se declara aquí
 * para que el esquema esté completo. El módulo que la explota todavía no está
 * construido: hoy ninguna ruta escribe en esta tabla.
 */
@Entity('reporte')
export class Reporte {
    /** Identificador del reporte. */
    @PrimaryGeneratedColumn('uuid', { name: 'id_reporte' })
    idReporte: string;

    /** Administrador que lo generó. */
    @Index()
    @Column({ name: 'id_admin', type: 'int', unsigned: true })
    idAdmin: number;

    /**
     * Autor asociado. `RESTRICT` impide borrar una cuenta que deje reportes
     * sin firma: el documento exige poder trazar quién consultó qué.
     */
    @ManyToOne(() => Admin, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'id_admin' })
    admin: Admin;

    /** Zona sobre la que se generó. `null` si abarca todas. */
    @Index()
    @Column({ name: 'id_zona', type: 'char', length: 36, nullable: true })
    idZona: string | null;

    /** Zona asociada. Al borrarla el reporte sobrevive, ya sin zona. */
    @ManyToOne(() => Zona, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'id_zona' })
    zona: Zona | null;

    /** Clase de reporte (ocupación por franja, comparativa de zonas...). */
    @Column({ name: 'tipo_reporte', length: 50 })
    tipoReporte: string;

    /** Inicio del rango temporal consultado. */
    @Column({ name: 'rango_inicio', type: 'datetime' })
    rangoInicio: Date;

    /** Fin del rango temporal consultado. */
    @Column({ name: 'rango_fin', type: 'datetime' })
    rangoFin: Date;

    /** Filtros y opciones con los que se generó, para poder reproducirlo. */
    @Column({ name: 'parametros', type: 'json', nullable: true })
    parametros: Record<string, unknown> | null;

    /** Momento en que se generó. */
    @CreateDateColumn({ name: 'fecha_generacion' })
    fechaGeneracion: Date;
}
