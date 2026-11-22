// ---------------------------------------------------------------------------
// equipos.repo.mjs: acceso a datos de equipos. Solo SQL: no recibe req ni res
// ni conoce códigos HTTP. Regla de seguridad: el SQL que se concatena lo
// escribimos nosotros; todo valor del usuario va en parámetros ($1, $2...).
// ---------------------------------------------------------------------------
import pool from './db.mjs';

// Equipos por página en el listado.
export const POR_PAGINA = 5;

// Lista blanca: la opción del usuario se traduce a SQL fijo.
// ORDER BY no admite parámetros ($n) para nombres de columna.
const ORDENES = { codigo: 'codigo', nombre: 'nombre' };

// En un ILIKE, % y _ son comodines y \ es el escape. Se escapan para que lo
// que escriba el usuario se busque como texto literal.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, '\\$&');

// Listado filtrado, ordenado y paginado. Devuelve { equipos, total }, donde
// total es el nº de equipos que cumplen los filtros (sin paginar).
export async function listarEquipos({ q, categoria, disponible, orden, pagina }) {
  // condiciones: trozos de SQL fijos escritos por nosotros.
  // valores: los datos del usuario, en el mismo orden que sus $n.
  const condiciones = [];
  const valores = [];

  if (q) {
    // Los % van en el VALOR, no en el SQL.
    valores.push(`%${escaparLike(q)}%`);
    // $${...} genera $1, $2... según la posición del valor en el array.
    condiciones.push(`nombre ILIKE $${valores.length}`);
  }
  if (categoria) {
    valores.push(categoria);
    condiciones.push(`categoria = $${valores.length}`);
  }
  if (disponible === 'true' || disponible === 'false') {
    // Se convierte a booleano real antes de enviarlo a PostgreSQL.
    valores.push(disponible === 'true');
    condiciones.push(`disponible = $${valores.length}`);
  }

  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  // Cualquier valor fuera de la lista blanca usa el orden por defecto.
  const columnaOrden = ORDENES[orden] ?? 'codigo';

  // Mismo WHERE y mismos valores que la consulta de datos, para que el total
  // coincida con lo filtrado. ::int porque count() devuelve bigint (texto en pg).
  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM practica_prestamos.equipos ${where}`,
    valores,
  );

  // LIMIT y OFFSET también van como parámetros, a continuación de los filtros.
  const limitPos = valores.length + 1;
  const offsetPos = valores.length + 2;
  // El desempate por id hace el orden determinista: sin él, filas con el mismo
  // valor podrían repetirse o saltarse entre páginas.
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

// Categorías distintas, para rellenar el select del filtro.
export async function listarCategorias() {
  const { rows } = await pool.query(
    'SELECT DISTINCT categoria FROM practica_prestamos.equipos ORDER BY categoria',
  );
  return rows.map((r) => r.categoria);
}

// Equipo + quién lo tiene ahora (prestado_a) o null si está disponible.
// Devuelve la fila o null si el equipo no existe.
// LEFT JOIN: un equipo sin préstamo activo debe aparecer igualmente.
// La condición del préstamo activo va en el ON para no descartar el equipo:
// en el WHERE, un equipo con préstamos pero todos devueltos desaparecería.
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

// Historial de préstamos de un equipo, del más reciente al más antiguo.
// Aquí basta un JOIN normal: todo préstamo tiene siempre un usuario.
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

// Columnas que devuelven las escrituras (RETURNING).
const COLUMNAS_EQUIPO = 'id, codigo, nombre, categoria, disponible';

// Inserta y devuelve la fila creada con RETURNING (sin un SELECT adicional).
// No se inserta "disponible": la BD lo deja en true por defecto.
export async function crearEquipo({ codigo, nombre, categoria }) {
  const { rows } = await pool.query(
    `INSERT INTO practica_prestamos.equipos (codigo, nombre, categoria)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNAS_EQUIPO}`,
    [codigo, nombre, categoria],
  );
  return rows[0];
}

// Nunca toca "disponible": solo cambia al prestar o devolver.
// Devuelve la fila actualizada o null: con un id inexistente el UPDATE no da
// error SQL, simplemente afecta a 0 filas (RETURNING no devuelve nada).
export async function actualizarEquipo(id, { codigo, nombre, categoria }) {
  const { rows } = await pool.query(
    `UPDATE practica_prestamos.equipos
        SET codigo = $1, nombre = $2, categoria = $3
      WHERE id = $4
      RETURNING ${COLUMNAS_EQUIPO}`,
    [codigo, nombre, categoria, id],
  );
  return rows[0] ?? null;
}

// Devuelve true si se borró una fila y false si el id no existía (rowCount = 0).
// Si el equipo tiene préstamos, PostgreSQL lanza 23503 (clave foránea).
export async function borrarEquipo(id) {
  const { rowCount } = await pool.query(
    'DELETE FROM practica_prestamos.equipos WHERE id = $1',
    [id],
  );
  return rowCount > 0;
}
