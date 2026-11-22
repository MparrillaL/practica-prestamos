import pg from 'pg';

// Sin credenciales: pg lee PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD del entorno
const pool = new pg.Pool({
  max: 5,
  connectionTimeoutMillis: 3000,
});

pool.on('error', () => {
  console.error('Error inesperado en una conexión inactiva de PostgreSQL');
});

export default pool;
