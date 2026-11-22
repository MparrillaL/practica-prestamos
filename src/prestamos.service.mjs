// ---------------------------------------------------------------------------
// prestamos.service.mjs: lógica de negocio de préstamos y devoluciones.
// Cada operación son DOS escrituras (equipo + préstamo) que deben ocurrir
// juntas o no ocurrir: por eso van dentro de una transacción.
// No conoce req, res ni códigos HTTP: lanza errores de dominio (ErrorDominio)
// y server.mjs los traduce.
// ---------------------------------------------------------------------------
import pool from './db.mjs';

// Error propio del negocio. "code" identifica el caso:
// NO_DISPONIBLE, EQUIPO_NO_EXISTE, NO_ACTIVO, PRESTAMO_NO_EXISTE.
export class ErrorDominio extends Error {
  constructor(code) {
    super(code);
    this.name = 'ErrorDominio';
    this.code = code;
  }
}

const COLUMNAS_PRESTAMO = 'id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion';

// Ejecuta "trabajo(cliente)" dentro de una transacción: COMMIT si termina bien,
// ROLLBACK si lanza cualquier error (que se vuelve a lanzar tras deshacer).
// Claves:
// 1. Un solo cliente (pool.connect): con pool.query cada sentencia podría ir por
//    una conexión distinta y el BEGIN no afectaría al resto.
// 2. release() en el finally: si no se libera, el pool (máx. 5) se agota.
async function transaccion(trabajo) {
  const cliente = await pool.connect();
  let destruir = false;
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await cliente.query('ROLLBACK');
    } catch {
      // Si el ROLLBACK falla la conexión no es fiable: se descarta del pool
      destruir = true;
    }
    throw err;
  } finally {
    // release(true) elimina la conexión del pool en lugar de reutilizarla.
    cliente.release(destruir);
  }
}

// Presta un equipo a un usuario. Devuelve el préstamo creado.
export function prestar(equipoId, usuarioId) {
  return transaccion(async (cliente) => {
    // Comprobar y modificar en una sola operación atómica. Con dos peticiones
    // simultáneas, la segunda espera el bloqueo de la fila, vuelve a evaluar
    // "disponible = true" y le afecta a 0 filas: nunca se presta dos veces.
    // Va ANTES del INSERT: si el usuario no existe, el fallo llega después de
    // haber escrito y el ROLLBACK deshace de verdad el UPDATE.
    const { rowCount } = await cliente.query(
      `UPDATE practica_prestamos.equipos
          SET disponible = false
        WHERE id = $1 AND disponible = true`,
      [equipoId],
    );
    if (rowCount === 0) {
      // 0 filas: o el equipo no existe o ya estaba prestado. Se distingue para
      // dar un error correcto (400 frente a 409).
      const { rowCount: existe } = await cliente.query(
        'SELECT 1 FROM practica_prestamos.equipos WHERE id = $1',
        [equipoId],
      );
      throw new ErrorDominio(existe ? 'NO_DISPONIBLE' : 'EQUIPO_NO_EXISTE');
    }

    // Si el usuario no existe falla aquí (23503), después del UPDATE: el ROLLBACK lo deshace
    const { rows } = await cliente.query(
      `INSERT INTO practica_prestamos.prestamos (equipo_id, usuario_id)
       VALUES ($1, $2)
       RETURNING ${COLUMNAS_PRESTAMO}`,
      [equipoId, usuarioId],
    );
    return rows[0];
  });
}

// Registra la devolución de un préstamo. Devuelve el préstamo ya cerrado.
export function devolver(prestamoId) {
  return transaccion(async (cliente) => {
    // Se "reclama" el préstamo de forma atómica: solo prospera si sigue activo
    // (fecha_devolucion IS NULL). Dos devoluciones simultáneas: la segunda
    // espera, ve que ya no es NULL y afecta a 0 filas.
    const { rows } = await cliente.query(
      `UPDATE practica_prestamos.prestamos
          SET fecha_devolucion = CURRENT_TIMESTAMP
        WHERE id = $1 AND fecha_devolucion IS NULL
        RETURNING ${COLUMNAS_PRESTAMO}`,
      [prestamoId],
    );
    if (rows.length === 0) {
      // Distingue "no existe" (404) de "ya devuelto" (409).
      const { rowCount: existe } = await cliente.query(
        'SELECT 1 FROM practica_prestamos.prestamos WHERE id = $1',
        [prestamoId],
      );
      throw new ErrorDominio(existe ? 'NO_ACTIVO' : 'PRESTAMO_NO_EXISTE');
    }

    // Segunda escritura: el equipo vuelve a estar disponible. Si fallara, el
    // ROLLBACK reabriría también el préstamo (todo o nada).
    await cliente.query(
      'UPDATE practica_prestamos.equipos SET disponible = true WHERE id = $1',
      [rows[0].equipo_id],
    );
    return rows[0];
  });
}
