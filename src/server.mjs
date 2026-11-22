import express from 'express';
import pool from './db.mjs';
import { fileURLToPath } from 'node:url';

const app = express();

app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('./views', import.meta.url)));

app.use(express.json({ limit: '10kb' }));

// Ruta de prueba temporal
app.get('/salud', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.send('ok');
  } catch (err) {
    next(err);
  }
});

try {
  await pool.query('SELECT 1');

  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Servidor escuchando en http://127.0.0.1:${port}`);
  });

  const cerrar = () => {
    server.close(async () => {
      await pool.end();
    });
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
} catch {
  console.error('PostgreSQL no disponible');
  await pool.end();
  process.exitCode = 1;
}
