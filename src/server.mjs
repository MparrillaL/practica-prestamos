import express from 'express';
import pool from './db.mjs';
import { listarCategorias, listarEquipos, POR_PAGINA } from './equipos.repo.mjs';
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

app.get('/equipos', async (req, res, next) => {
  try {
    const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

    const filtros = {
      q: texto(req.query.q).slice(0, 100),
      categoria: texto(req.query.categoria).slice(0, 100),
      disponible: ['true', 'false'].includes(req.query.disponible) ? req.query.disponible : '',
      orden: req.query.orden === 'nombre' ? 'nombre' : 'codigo',
    };

    const paginaSolicitada = Number(req.query.pagina);
    const pagina = Number.isSafeInteger(paginaSolicitada) && paginaSolicitada >= 1 ? paginaSolicitada : 1;

    const [{ equipos, total }, categorias] = await Promise.all([
      listarEquipos({ ...filtros, pagina }),
      listarCategorias(),
    ]);
    const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

    // Solo se incluyen los filtros con valor para mantener limpia la URL
    const enlace = (n) =>
      '/equipos?' +
      new URLSearchParams({
        ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '')),
        pagina: n,
      });

    if (pagina > totalPaginas) {
      return res.redirect(enlace(totalPaginas));
    }

    res.render('equipos', {
      equipos,
      total,
      pagina,
      totalPaginas,
      filtros,
      categorias,
      anterior: pagina > 1 ? enlace(pagina - 1) : null,
      siguiente: pagina < totalPaginas ? enlace(pagina + 1) : null,
    });
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
