import pool from './db.mjs';

export const POR_PAGINA = 5;

// Lista blanca: la opción del usuario se traduce a SQL fijo
const ORDENES = { codigo: 'codigo', nombre: 'nombre' };

const escaparLike = (texto) => texto.replace(/[\\%_]/g, '\\$&');

export async function listarEquipos({ q, categoria, disponible, orden, pagina }) {
  const condiciones = [];
  const valores = [];

  if (q) {
    valores.push(`%${escaparLike(q)}%`);
    condiciones.push(`nombre ILIKE $${valores.length}`);
  }
  if (categoria) {
    valores.push(categoria);
    condiciones.push(`categoria = $${valores.length}`);
  }
  if (disponible === 'true' || disponible === 'false') {
    valores.push(disponible === 'true');
    condiciones.push(`disponible = $${valores.length}`);
  }

  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const columnaOrden = ORDENES[orden] ?? 'codigo';

  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM practica_prestamos.equipos ${where}`,
    valores,
  );

  const limitPos = valores.length + 1;
  const offsetPos = valores.length + 2;
  const { rows: equipos } = await pool.query(
    `SELECT id, codigo, nombre, categoria, disponible
       FROM practica_prestamos.equipos
       ${where}
      ORDER BY ${columnaOrden}, id
      LIMIT $${limitPos} OFFSET $${offsetPos}`,
    [...valores, POR_PAGINA, (pagina - 1) * POR_PAGINA],
  );

  return { equipos, total };
}

export async function listarCategorias() {
  const { rows } = await pool.query(
    'SELECT DISTINCT categoria FROM practica_prestamos.equipos ORDER BY categoria',
  );
  return rows.map((r) => r.categoria);
}

// LEFT JOIN: un equipo sin préstamo activo debe aparecer igualmente.
// La condición del préstamo activo va en el ON para no descartar el equipo.
export async function obtenerEquipo(id) {
  const { rows } = await pool.query(
    `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
            u.nombre AS prestado_a
       FROM practica_prestamos.equipos e
       LEFT JOIN practica_prestamos.prestamos p
              ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
       LEFT JOIN practica_prestamos.usuarios u
              ON u.id = p.usuario_id
      WHERE e.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function historialPrestamos(id) {
  const { rows } = await pool.query(
    `SELECT p.id, u.nombre AS usuario, p.fecha_prestamo, p.fecha_devolucion
       FROM practica_prestamos.prestamos p
       JOIN practica_prestamos.usuarios u ON u.id = p.usuario_id
      WHERE p.equipo_id = $1
      ORDER BY p.fecha_prestamo DESC, p.id DESC`,
    [id],
  );
  return rows;
}
