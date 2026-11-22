// ---------------------------------------------------------------------------
// server.mjs: arranque de Express, rutas (vistas y API) y manejo de errores.
// Capas: server.mjs (HTTP) -> equipos.repo.mjs / prestamos.service.mjs (SQL)
// -> db.mjs (pool). Solo este archivo conoce req, res y los códigos HTTP.
// ---------------------------------------------------------------------------
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
import { devolver, ErrorDominio, prestar } from './prestamos.service.mjs';

const app = express();

// Motor de plantillas EJS. La carpeta de vistas se calcula desde la ubicación
// de este archivo (import.meta.url) para no depender del directorio actual.
app.set('view engine', 'ejs');
app.set('views', fileURLToPath(new URL('./views', import.meta.url)));

// Parsea cuerpos JSON. El límite de 10 kB evita que alguien envíe cuerpos
// enormes (si se supera, el manejador final responde 413).
app.use(express.json({ limit: '10kb' }));

// ---------------------------------------------------------------------------
// Vista: listado de equipos con filtros, orden y paginación
// ---------------------------------------------------------------------------
app.get('/equipos', async (req, res, next) => {
  try {
    // Todo lo que llega en req.query es entrada del usuario: puede faltar o
    // venir como array/objeto (?q=a&q=b). Solo se acepta si es un string.
    const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

    // Normalización: cada filtro queda con un valor seguro o vacío.
    const filtros = {
      q: texto(req.query.q).slice(0, 100),
      categoria: texto(req.query.categoria).slice(0, 100),
      disponible: ['true', 'false'].includes(req.query.disponible) ? req.query.disponible : '',
      orden: req.query.orden === 'nombre' ? 'nombre' : 'codigo',
    };

    // La página debe ser un entero >= 1; en cualquier otro caso, la 1.
    // isSafeInteger evita números enormes que desbordarían el OFFSET de SQL.
    const paginaSolicitada = Number(req.query.pagina);
    const pagina = Number.isSafeInteger(paginaSolicitada) && paginaSolicitada >= 1 ? paginaSolicitada : 1;

    // Las dos consultas son independientes, así que se lanzan a la vez.
    const [{ equipos, total }, categorias] = await Promise.all([
      listarEquipos({ ...filtros, pagina }),
      listarCategorias(),
    ]);
    const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

    // Construye el enlace a la página n conservando los filtros.
    // Solo se incluyen los filtros con valor para mantener limpia la URL;
    // URLSearchParams codifica correctamente los caracteres especiales.
    const enlace = (n) =>
      '/equipos?' +
      new URLSearchParams({
        ...Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== '')),
        pagina: n,
      });

    // Si piden una página que no existe, se redirige a la última en lugar
    // de mostrar "sin resultados" cuando sí hay equipos.
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
    // Se delega el error al manejador final (try/catch explícito; las rutas de
    // la API de más abajo se apoyan en que Express 5 lo hace automáticamente).
    next(err);
  }
});

// Valida el parámetro :id de TODAS las rutas que lo usen (vistas y API).
// Debe ser un entero positivo sin ceros a la izquierda ni decimales y caber en
// un integer de PostgreSQL (2147483647); si no, 400 sin llegar a la base de datos.
// El id ya convertido a número queda en req.id.
app.param('id', (req, res, next, valor) => {
  const id = Number(valor);
  if (!/^[1-9]\d*$/.test(valor) || id > 2147483647) {
    return res.status(400).send('Identificador no válido');
  }
  req.id = id;
  next();
});

// ---------------------------------------------------------------------------
// Vista: ficha de un equipo con su historial de préstamos
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// API de equipos (JSON)
// ---------------------------------------------------------------------------

// Código: mayúsculas, dígitos y guion, de 1 a 20 caracteres (varchar(20) en BD).
const CODIGO_VALIDO = /^[A-Z0-9-]{1,20}$/;
// Máximo razonable para nombre y categoría (en BD son text, sin límite).
const MAX_TEXTO = 80;

// Valida el cuerpo de POST/PUT de equipos. No toca la base de datos.
// Devuelve { errores } si hay fallos o { datos } con los valores ya limpios.
// Solo se leen codigo, nombre y categoria: cualquier otro campo (por ejemplo
// "disponible") se ignora, así el cliente nunca puede cambiar el estado.
function validarEquipo(body) {
  // express.json deja body undefined si no hay cuerpo; también puede ser null o un array.
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

// Alta: 201 Created + cabecera Location con la URL del recurso nuevo.
// Express 5 envía al manejador final cualquier error de una función async,
// por eso estas rutas no necesitan try/catch.
app.post('/api/equipos', async (req, res) => {
  const { errores, datos } = validarEquipo(req.body);
  if (errores) {
    return res.status(400).json({ errores });
  }
  const equipo = await crearEquipo(datos);
  res.status(201).location('/equipos/' + equipo.id).json(equipo);
});

// Modificación: 200 con el equipo, o 404 si el id no existe.
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

// Borrado: 204 sin cuerpo. El 409 (equipo con préstamos) lo produce la clave
// foránea de la BD (23503) y lo traduce el manejador final.
app.delete('/api/equipos/:id', async (req, res) => {
  if (!(await borrarEquipo(req.id))) {
    return res.status(404).json({ error: 'Equipo no encontrado' });
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// API de préstamos (JSON)
// ---------------------------------------------------------------------------

// En el JSON los ids llegan como números: se exige entero entre 1 y el máximo
// de un integer de PostgreSQL (así un id gigante no provoca un error de BD).
const esIdValido = (valor) => Number.isInteger(valor) && valor >= 1 && valor <= 2147483647;

// Préstamo: 201 con el préstamo creado. La lógica transaccional está en el servicio.
app.post('/api/prestamos', async (req, res) => {
  const { equipoId, usuarioId } = req.body ?? {};
  if (!esIdValido(equipoId) || !esIdValido(usuarioId)) {
    return res.status(400).json({
      errores: ['equipoId y usuarioId deben ser enteros positivos'],
    });
  }
  const prestamo = await prestar(equipoId, usuarioId);
  res.status(201).json(prestamo);
});

// Devolución: 200 con el préstamo cerrado. El id ya lo validó app.param('id').
app.post('/api/prestamos/:id/devolucion', async (req, res) => {
  const prestamo = await devolver(req.id);
  res.json(prestamo);
});

// ---------------------------------------------------------------------------
// Manejador final de errores
// ---------------------------------------------------------------------------
// Debe ir DESPUÉS de todas las rutas y tener exactamente 4 parámetros: así
// Express lo reconoce como manejador de errores. Es el único sitio que traduce
// errores a códigos HTTP. Se decide por err.code / err.type / err.constraint,
// nunca por el texto del mensaje, y nunca se envía err.message al cliente.
app.use((err, req, res, next) => {
  // Si ya se empezó a responder no se puede cambiar el estado: lo gestiona Express.
  if (res.headersSent) {
    return next(err);
  }
  // Errores de express.json
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON mal formado' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Cuerpo demasiado grande' });
  }
  // Errores de dominio lanzados por prestamos.service.mjs
  if (err instanceof ErrorDominio) {
    switch (err.code) {
      case 'NO_DISPONIBLE':
        return res.status(409).json({ error: 'El equipo no está disponible' });
      // 409: el préstamo existe, pero su estado (ya devuelto) impide la operación
      case 'NO_ACTIVO':
        return res.status(409).json({ error: 'El préstamo ya fue devuelto' });
      case 'PRESTAMO_NO_EXISTE':
        return res.status(404).json({ error: 'Préstamo no encontrado' });
      // 400: la URL existe, pero el cuerpo referencia un equipo que no existe
      case 'EQUIPO_NO_EXISTE':
        return res.status(400).json({ error: 'El equipo indicado no existe' });
    }
  }
  // Errores de PostgreSQL: err.code es el SQLSTATE
  switch (err.code) {
    // 23505: violación de UNIQUE
    case '23505':
      if (err.constraint === 'prestamo_activo_por_equipo') {
        return res.status(409).json({ error: 'El equipo ya tiene un préstamo activo' });
      }
      return res.status(409).json({ error: 'Ya existe un equipo con ese código' });
    // 23503: violación de clave foránea
    case '23503':
      // Se distingue por el nombre de la restricción, nunca por el mensaje
      if (err.constraint === 'prestamos_usuario_id_fkey') {
        return res.status(400).json({ error: 'El usuario indicado no existe' });
      }
      // Si no, es el borrado de un equipo que tiene préstamos
      return res.status(409).json({ error: 'El equipo tiene préstamos asociados' });
    // 23514 CHECK, 23502 NOT NULL, 22001 texto demasiado largo
    case '23514':
    case '23502':
    case '22001':
      return res.status(400).json({ error: 'Datos no válidos' });
  }
  // Cualquier otro error es inesperado: se registra en el servidor con todo el
  // detalle, pero al cliente solo le llega un mensaje genérico.
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
// Antes de abrir el puerto se comprueba que PostgreSQL responde, para fallar
// pronto y con un mensaje claro en lugar de errores en cada petición.
try {
  await pool.query('SELECT 1');

  const port = Number(process.env.PORT) || 3000;
  // Solo 127.0.0.1: la aplicación no es accesible desde otras máquinas.
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Servidor escuchando en http://127.0.0.1:${port}`);
  });

  // Cierre ordenado: deja de aceptar conexiones y, cuando terminan las
  // peticiones en curso, cierra el pool. "once" evita registrar el cierre
  // más de una vez si llega la señal repetida.
  const cerrar = () => {
    server.close(async () => {
      await pool.end();
    });
  };
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  console.error('PostgreSQL no disponible');
  // Se libera el pool para que el proceso pueda terminar; exitCode = 1 indica error.
  await pool.end();
  process.exitCode = 1;
}
