import express from 'express';
import pool from './db.mjs';
import {
  actualizarEquipo,
  borrarEquipo,
  crearEquipo,
  historialPrestamos,
  listarCategorias,
  listarEquipos,
  obtenerEquipo,
  POR_PAGINA,
} from './equipos.repo.mjs';
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

app.param('id', (req, res, next, valor) => {
  const id = Number(valor);
  if (!/^[1-9]\d*$/.test(valor) || id > 2147483647) {
    return res.status(400).send('Identificador no válido');
  }
  req.id = id;
  next();
});

app.get('/equipos/:id', async (req, res, next) => {
  try {
    const equipo = await obtenerEquipo(req.id);
    if (!equipo) {
      return res.status(404).send('Equipo no encontrado');
    }
    const historial = await historialPrestamos(req.id);
    res.render('equipo', { equipo, historial });
  } catch (err) {
    next(err);
  }
});

const CODIGO_VALIDO = /^[A-Z0-9-]{1,20}$/;
const MAX_TEXTO = 80;

function validarEquipo(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { errores: ['El cuerpo debe ser un objeto JSON'] };
  }

  const errores = [];
  const { codigo, nombre, categoria } = body;

  if (typeof codigo !== 'string' || !CODIGO_VALIDO.test(codigo)) {
    errores.push('codigo debe ser texto de 1 a 20 caracteres: mayúsculas, dígitos o guion');
  }
  for (const [campo, valor] of [['nombre', nombre], ['categoria', categoria]]) {
    if (typeof valor !== 'string' || valor.trim() === '' || valor.trim().length > MAX_TEXTO) {
      errores.push(`${campo} debe ser texto no vacío de hasta ${MAX_TEXTO} caracteres`);
    }
  }

  if (errores.length > 0) {
    return { errores };
  }
  return { datos: { codigo, nombre: nombre.trim(), categoria: categoria.trim() } };
}

app.post('/api/equipos', async (req, res) => {
  const { errores, datos } = validarEquipo(req.body);
  if (errores) {
    return res.status(400).json({ errores });
  }
  const equipo = await crearEquipo(datos);
  res.status(201).location('/equipos/' + equipo.id).json(equipo);
});

app.put('/api/equipos/:id', async (req, res) => {
  const { errores, datos } = validarEquipo(req.body);
  if (errores) {
    return res.status(400).json({ errores });
  }
  const equipo = await actualizarEquipo(req.id, datos);
  if (!equipo) {
    return res.status(404).json({ error: 'Equipo no encontrado' });
  }
  res.json(equipo);
});

app.delete('/api/equipos/:id', async (req, res) => {
  if (!(await borrarEquipo(req.id))) {
    return res.status(404).json({ error: 'Equipo no encontrado' });
  }
  res.status(204).end();
});

// Manejador final: debe ir después de todas las rutas y tener 4 parámetros
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON mal formado' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Cuerpo demasiado grande' });
  }
  switch (err.code) {
    case '23505':
      return res.status(409).json({ error: 'Ya existe un equipo con ese código' });
    case '23503':
      return res.status(409).json({ error: 'El equipo tiene préstamos asociados' });
    case '23514':
    case '23502':
    case '22001':
      return res.status(400).json({ error: 'Datos no válidos' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
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
