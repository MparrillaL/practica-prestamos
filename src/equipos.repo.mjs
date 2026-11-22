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
