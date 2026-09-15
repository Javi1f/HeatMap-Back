import { ConflictError, NotFoundError } from '../../common/errors';
import type { RolAdmin } from '../../models/Admin.entity';

/**
 * Reglas de gestión de roles y de activación de cuentas.
 *
 * Son funciones puras sobre una foto de los administradores: el servicio las
 * consulta antes de escribir, y así las reglas se prueban sin base de datos.
 * La que importa es la misma en todas: **nunca puede quedar el sistema sin un
 * administrador `root` activo**, porque nadie podría volver a gestionar usuarios.
 */

/** Lo que las reglas necesitan saber de cada administrador. */
export interface EstadoAdmin {
    /** Identificador del administrador. */
    id: number;

    /** Rol vigente. */
    rol: RolAdmin;

    /** `false` si la cuenta está desactivada. */
    activo: boolean;
}

/** Mensaje común a las operaciones que dejarían el sistema sin `root`. */
const SIN_ROOT = 'Debe quedar al menos un administrador root activo';

/** Busca al administrador objetivo o lanza `NotFoundError`. */
const buscar = (admins: readonly EstadoAdmin[], id: number): EstadoAdmin => {
    const objetivo = admins.find((admin) => admin.id === id);
    if (!objetivo) throw new NotFoundError('El administrador no existe');
    return objetivo;
};

/** Indica si queda algún `root` activo distinto del administrador indicado. */
const hayOtroRootActivo = (admins: readonly EstadoAdmin[], id: number): boolean =>
    admins.some((admin) => admin.id !== id && admin.activo && admin.rol === 'root');

/**
 * Valida un cambio de rol.
 *
 * @throws NotFoundError si el administrador no existe.
 * @throws ConflictError si se quitaría el rol `root` al último `root` activo.
 */
export const validarCambioRol = (admins: readonly EstadoAdmin[], idObjetivo: number, nuevoRol: RolAdmin): void => {
    const objetivo = buscar(admins, idObjetivo);
    const pierdeRoot = objetivo.rol === 'root' && nuevoRol !== 'root';
    if (pierdeRoot && objetivo.activo && !hayOtroRootActivo(admins, idObjetivo)) {
        throw new ConflictError(SIN_ROOT);
    }
};

/**
 * Valida la activación o desactivación de una cuenta.
 *
 * Nadie puede desactivarse a sí mismo: se quedaría fuera en mitad de la
 * operación y, si era el último `root`, sin forma de volver.
 *
 * @throws NotFoundError si el administrador no existe.
 * @throws ConflictError si se desactiva a sí mismo o al último `root` activo.
 */
export const validarCambioActivo = (
    admins: readonly EstadoAdmin[],
    idSolicitante: number,
    idObjetivo: number,
    activo: boolean,
): void => {
    const objetivo = buscar(admins, idObjetivo);
    if (activo) return;
    if (idSolicitante === idObjetivo) throw new ConflictError('No puedes desactivar tu propia cuenta');
    if (objetivo.rol === 'root' && !hayOtroRootActivo(admins, idObjetivo)) throw new ConflictError(SIN_ROOT);
};
