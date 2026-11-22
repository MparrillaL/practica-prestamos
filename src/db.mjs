// ---------------------------------------------------------------------------
// db.mjs: única conexión a PostgreSQL de toda la aplicación.
// ---------------------------------------------------------------------------
import pg from 'pg';

// Pool de conexiones reutilizables: abrir una conexión por consulta sería lento.
// - max: 5 conexiones simultáneas como máximo.
// - connectionTimeoutMillis: si no hay conexión en 3 s, falla en vez de colgarse.
// Sin credenciales en el código: pg lee PGHOST, PGPORT, PGDATABASE, PGUSER y
// PGPASSWORD del entorno (las carga npm start desde .env, que no se sube a git).
const pool = new pg.Pool({
  max: 5,
  connectionTimeoutMillis: 3000,
});

// Sin este manejador, un error en una conexión inactiva (por ejemplo, PostgreSQL
// se reinicia) tumbaría el proceso. El mensaje es genérico: nada de detalles internos.
pool.on('error', () => {
  console.error('Error inesperado en una conexión inactiva de PostgreSQL');
});

export default pool;
