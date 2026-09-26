import {
    BeforeInsert,
    Check,
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from 'typeorm';
import { Admin } from './Admin.entity';
import { Zona } from './Zona.entity';
import { COLUMNA_UUID, nuevoUuid } from './uuid';

/**
 * Consulta consolidada que un responsable institucional genera y conserva.
 *
 * Guarda la definición del reporte, no su resultado: el rango, la zona y los
 * filtros con los que se pidió. Los datos se recalculan al abrirlo, de modo
 * que un mismo reporte refleja siempre el estado actual de la información en
 * lugar de una foto congelada que envejece.
 *
 * Entidad REPORTE del Anexo 13; la explota el módulo `historicos/reportes`
 * (RF-05 y RF-07).
 */
@Entity('reporte')
@Index('idx_reporte_admin', ['idAdmin'])
@Index('idx_reporte_zona', ['idZona'])
@Index('idx_reporte_fecha', ['fechaGeneracion'])
@Check('chk_reporte_rango', '`rango_fin` > `rango_inicio`')
export class Reporte {
    /** Identificador del reporte. */
    @PrimaryColumn({ name: 'id_reporte', ...COLUMNA_UUID })
    idReporte: string;

    /** Administrador que lo generó. */
    @Column({ name: 'id_admin', ...COLUMNA_UUID })
    idAdmin: string;

    /**
     * Autor asociado. `RESTRICT` impide borrar una cuenta que deje reportes
     * sin firma: el documento exige poder trazar quién consultó qué.
     */
    @ManyToOne(() => Admin, { onDelete: 'RESTRICT', onUpdate: 'CASCADE' })
    @JoinColumn({ name: 'id_admin', foreignKeyConstraintName: 'fk_reporte_admin' })
    admin: Admin;

    /** Zona sobre la que se generó. `null` si abarca todas. */
    @Column({ name: 'id_zona', ...COLUMNA_UUID, nullable: true })
    idZona: string | null;

    /** Zona asociada. Al borrarla el reporte sobrevive, ya sin zona. */
    @ManyToOne(() => Zona, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'id_zona', foreignKeyConstraintName: 'fk_reporte_zona' })
    zona: Zona | null;

    /** Clase de reporte (ocupación por franja, comparativa de zonas...). */
    @Column({ name: 'tipo_reporte', type: 'varchar', length: 50 })
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
    @CreateDateColumn({ name: 'fecha_generacion', type: 'datetime', precision: 6 })
    fechaGeneracion: Date;

    /** Asigna el UUID al insertar, si no se dio uno. */
    @BeforeInsert()
    protected asignarId(): void {
        this.idReporte ??= nuevoUuid();
    }
}
