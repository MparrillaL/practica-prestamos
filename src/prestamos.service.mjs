import pool from './db.mjs';

export class ErrorDominio extends Error {
  constructor(code) {
    super(code);
    this.name = 'ErrorDominio';
    this.code = code;
  }
}

const COLUMNAS_PRESTAMO = 'id, equipo_id, usuario_id, fecha_prestamo, fecha_devolucion';

// Un solo cliente para todo el BEGIN...COMMIT; siempre se libera
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
    cliente.release(destruir);
  }
}

export function prestar(equipoId, usuarioId) {
  return transaccion(async (cliente) => {
    // Comprobar y modificar en una sola operación atómica
    const { rowCount } = await cliente.query(
      `UPDATE practica_prestamos.equipos
          SET disponible = false
        WHERE id = $1 AND disponible = true`,
      [equipoId],
    );
    if (rowCount === 0) {
      const { rowCount: existe } = await cliente.query(
        'SELECT 1 FROM practica_prestamos.equipos WHERE id = $1',
        [equipoId],
      );
      throw new ErrorDominio(existe ? 'NO_DISPONIBLE' : 'EQUIPO_NO_EXISTE');
    }

    // Si el usuario no existe falla aquí, después del UPDATE: el ROLLBACK lo deshace
    const { rows } = await cliente.query(
      `INSERT INTO practica_prestamos.prestamos (equipo_id, usuario_id)
       VALUES ($1, $2)
       RETURNING ${COLUMNAS_PRESTAMO}`,
      [equipoId, usuarioId],
    );
    return rows[0];
  });
}

export function devolver(prestamoId) {
  return transaccion(async (cliente) => {
    const { rows } = await cliente.query(
      `UPDATE practica_prestamos.prestamos
          SET fecha_devolucion = CURRENT_TIMESTAMP
        WHERE id = $1 AND fecha_devolucion IS NULL
        RETURNING ${COLUMNAS_PRESTAMO}`,
      [prestamoId],
    );
    if (rows.length === 0) {
      const { rowCount: existe } = await cliente.query(
        'SELECT 1 FROM practica_prestamos.prestamos WHERE id = $1',
        [prestamoId],
      );
      throw new ErrorDominio(existe ? 'NO_ACTIVO' : 'PRESTAMO_NO_EXISTE');
    }

    await cliente.query(
      'UPDATE practica_prestamos.equipos SET disponible = true WHERE id = $1',
      [rows[0].equipo_id],
    );
    return rows[0];
  });
}
