import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const CODIGO = 'TEST-' + Date.now().toString(36).toUpperCase().slice(-10);
const CODIGO_2 = CODIGO + 'B';

let ok = 0;
let fallos = 0;

async function caso(nombre, fn) {
  try {
    await fn();
    ok++;
    console.log(`OK    ${nombre}`);
  } catch (err) {
    fallos++;
    console.log(`FALLO ${nombre}\n      ${err.message.split('\n')[0]}`);
  }
}

async function peticion(metodo, ruta, { json, crudo, tipo = 'application/json' } = {}) {
  const opciones = { method: metodo, redirect: 'manual' };
  if (json !== undefined || crudo !== undefined) {
    opciones.headers = { 'Content-Type': tipo };
    opciones.body = crudo ?? JSON.stringify(json);
  }
  const res = await fetch(BASE + ruta, opciones);
  const texto = await res.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  return { res, status: res.status, cuerpo, texto };
}

const valido = { codigo: CODIGO, nombre: '  Equipo de prueba ', categoria: 'Pruebas' };
let id;
let id2;

await caso('POST válido → 201, Location y JSON con disponible=true', async () => {
  const { res, status, cuerpo } = await peticion('POST', '/api/equipos', {
    json: { ...valido, disponible: false },
  });
  assert.equal(status, 201);
  id = cuerpo.id;
  assert.equal(res.headers.get('location'), `/equipos/${id}`);
  assert.equal(cuerpo.codigo, CODIGO);
  assert.equal(cuerpo.nombre, 'Equipo de prueba');
  assert.equal(cuerpo.disponible, true);
});

await caso('POST con código repetido → 409', async () => {
  const { status } = await peticion('POST', '/api/equipos', { json: valido });
  assert.equal(status, 409);
});

const invalidos = {
  'código en minúsculas': { ...valido, codigo: 'abc' },
  'código vacío': { ...valido, codigo: '' },
  'código de 21 caracteres': { ...valido, codigo: 'A'.repeat(21) },
  'código no string': { ...valido, codigo: 123 },
  'nombre solo espacios': { ...valido, nombre: '   ' },
  'nombre de 81 caracteres': { ...valido, nombre: 'x'.repeat(81) },
  'categoría no string': { ...valido, categoria: ['a'] },
  'falta categoría': { codigo: CODIGO, nombre: 'x' },
  'cuerpo array': [valido],
  'cuerpo null': null,
};
for (const [nombre, json] of Object.entries(invalidos)) {
  await caso(`POST ${nombre} → 400`, async () => {
    const { status, cuerpo } = await peticion('POST', '/api/equipos', { json });
    assert.equal(status, 400);
    assert.ok(cuerpo.errores || cuerpo.error);
  });
}

await caso('POST sin cuerpo → 400', async () => {
  const { status } = await peticion('POST', '/api/equipos');
  assert.equal(status, 400);
});

await caso('POST con JSON mal formado → 400 sin detalles internos', async () => {
  const { status, texto } = await peticion('POST', '/api/equipos', { crudo: '{"codigo": ' });
  assert.equal(status, 400);
  assert.ok(!/SyntaxError|Unexpected|at /.test(texto), texto);
});

await caso('POST con cuerpo > 10kb → 413', async () => {
  const { status } = await peticion('POST', '/api/equipos', {
    json: { ...valido, nombre: 'x'.repeat(20000) },
  });
  assert.equal(status, 413);
});

await caso('PUT válido → 200 y no cambia disponible', async () => {
  const { status, cuerpo } = await peticion('PUT', `/api/equipos/${id}`, {
    json: { codigo: CODIGO, nombre: 'Nombre nuevo', categoria: 'Otra', disponible: false },
  });
  assert.equal(status, 200);
  assert.equal(cuerpo.nombre, 'Nombre nuevo');
  assert.equal(cuerpo.categoria, 'Otra');
  assert.equal(cuerpo.disponible, true);
});

await caso('PUT con código de otro equipo → 409', async () => {
  const creado = await peticion('POST', '/api/equipos', { json: { ...valido, codigo: CODIGO_2 } });
  assert.equal(creado.status, 201);
  id2 = creado.cuerpo.id;
  const { status } = await peticion('PUT', `/api/equipos/${id2}`, { json: valido });
  assert.equal(status, 409);
});

await caso('PUT con cuerpo inválido → 400', async () => {
  const { status } = await peticion('PUT', `/api/equipos/${id}`, { json: { codigo: 'x' } });
  assert.equal(status, 400);
});

await caso('PUT a un id inexistente → 404', async () => {
  const { status } = await peticion('PUT', '/api/equipos/2147483647', { json: valido });
  assert.equal(status, 404);
});

for (const metodo of ['PUT', 'DELETE']) {
  await caso(`${metodo} con id mal formado → 400`, async () => {
    const { status } = await peticion(metodo, '/api/equipos/abc', { json: valido });
    assert.equal(status, 400);
  });
}

await caso('DELETE → 204 sin cuerpo', async () => {
  const { status, texto } = await peticion('DELETE', `/api/equipos/${id}`);
  assert.equal(status, 204);
  assert.equal(texto, '');
});

await caso('DELETE repetido → 404', async () => {
  const { status } = await peticion('DELETE', `/api/equipos/${id}`);
  assert.equal(status, 404);
});

await caso('GET del equipo borrado → 404', async () => {
  const { status } = await peticion('GET', `/equipos/${id}`);
  assert.equal(status, 404);
});

// ---- Fase 6: préstamos y devoluciones ----
const NOMBRE_P = 'Equipo-prestamos-' + CODIGO;
const USUARIO_EXISTENTE = 1;
const ID_INEXISTENTE = 2147483647;
let equipoP;
let prestamoP;

async function estaDisponible() {
  const { texto } = await peticion('GET', `/equipos?q=${encodeURIComponent(NOMBRE_P)}`);
  assert.ok(texto.includes(NOMBRE_P), 'el equipo no aparece en el listado');
  return texto.includes('<td>Disponible</td>');
}

await caso('preparación: crear equipo para los préstamos', async () => {
  const { status, cuerpo } = await peticion('POST', '/api/equipos', {
    json: { codigo: CODIGO + 'P', nombre: NOMBRE_P, categoria: 'Pruebas' },
  });
  assert.equal(status, 201);
  equipoP = cuerpo.id;
  assert.equal(await estaDisponible(), true);
});

const prestamosInvalidos = {
  'ids como string': { equipoId: '1', usuarioId: '1' },
  'equipoId 0': { equipoId: 0, usuarioId: 1 },
  'usuarioId negativo': { equipoId: 1, usuarioId: -1 },
  'equipoId decimal': { equipoId: 1.5, usuarioId: 1 },
  'usuarioId fuera de rango': { equipoId: 1, usuarioId: 2147483648 },
  'falta usuarioId': { equipoId: 1 },
  'cuerpo array': [],
};
for (const [nombre, json] of Object.entries(prestamosInvalidos)) {
  await caso(`POST /api/prestamos ${nombre} → 400`, async () => {
    const { status } = await peticion('POST', '/api/prestamos', { json });
    assert.equal(status, 400);
  });
}

await caso('prestar con equipo inexistente → 400', async () => {
  const { status } = await peticion('POST', '/api/prestamos', {
    json: { equipoId: ID_INEXISTENTE, usuarioId: USUARIO_EXISTENTE },
  });
  assert.equal(status, 400);
});

await caso('prestar con usuario inexistente → 400 y ROLLBACK (equipo sigue disponible)', async () => {
  const { status, cuerpo } = await peticion('POST', '/api/prestamos', {
    json: { equipoId: equipoP, usuarioId: ID_INEXISTENTE },
  });
  assert.equal(status, 400);
  assert.match(cuerpo.error, /usuario/);
  assert.equal(await estaDisponible(), true);
});

await caso('8 fallos seguidos no agotan el pool (máx. 5 conexiones)', async () => {
  for (let i = 0; i < 8; i++) {
    const { status } = await peticion('POST', '/api/prestamos', {
      json: { equipoId: equipoP, usuarioId: ID_INEXISTENTE },
    });
    assert.equal(status, 400);
  }
});

await caso('prestar → 201 y el equipo pasa a no disponible', async () => {
  const { status, cuerpo } = await peticion('POST', '/api/prestamos', {
    json: { equipoId: equipoP, usuarioId: USUARIO_EXISTENTE },
  });
  assert.equal(status, 201);
  assert.equal(cuerpo.equipo_id, equipoP);
  assert.equal(cuerpo.fecha_devolucion, null);
  prestamoP = cuerpo.id;
  assert.equal(await estaDisponible(), false);
});

await caso('prestar un equipo ya prestado → 409', async () => {
  const { status } = await peticion('POST', '/api/prestamos', {
    json: { equipoId: equipoP, usuarioId: USUARIO_EXISTENTE },
  });
  assert.equal(status, 409);
});

await caso('no se puede borrar un equipo con historial → 409', async () => {
  const { status } = await peticion('DELETE', `/api/equipos/${equipoP}`);
  assert.equal(status, 409);
});

await caso('devolver → 200 y el equipo vuelve a estar disponible', async () => {
  const { status, cuerpo } = await peticion('POST', `/api/prestamos/${prestamoP}/devolucion`);
  assert.equal(status, 200);
  assert.ok(cuerpo.fecha_devolucion);
  assert.equal(await estaDisponible(), true);
});

await caso('devolver otra vez → 409', async () => {
  const { status } = await peticion('POST', `/api/prestamos/${prestamoP}/devolucion`);
  assert.equal(status, 409);
});

await caso('devolver préstamo inexistente → 404', async () => {
  const { status } = await peticion('POST', `/api/prestamos/${ID_INEXISTENTE}/devolucion`);
  assert.equal(status, 404);
});

await caso('devolver con id mal formado → 400', async () => {
  const { status } = await peticion('POST', '/api/prestamos/abc/devolucion');
  assert.equal(status, 400);
});

await caso('6 peticiones simultáneas por el mismo equipo → 1 solo 201 y 5 × 409', async () => {
  const respuestas = await Promise.all(
    Array.from({ length: 6 }, () =>
      peticion('POST', '/api/prestamos', {
        json: { equipoId: equipoP, usuarioId: USUARIO_EXISTENTE },
      }),
    ),
  );
  const estados = respuestas.map((r) => r.status).sort();
  assert.deepEqual(estados, [201, 409, 409, 409, 409, 409]);
  const ganador = respuestas.find((r) => r.status === 201);
  const { status } = await peticion('POST', `/api/prestamos/${ganador.cuerpo.id}/devolucion`);
  assert.equal(status, 200);
});

await caso('2 devoluciones simultáneas del mismo préstamo → 1 solo 200 y 1 × 409', async () => {
  const nuevo = await peticion('POST', '/api/prestamos', {
    json: { equipoId: equipoP, usuarioId: USUARIO_EXISTENTE },
  });
  assert.equal(nuevo.status, 201);
  const ruta = `/api/prestamos/${nuevo.cuerpo.id}/devolucion`;
  const respuestas = await Promise.all([peticion('POST', ruta), peticion('POST', ruta)]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await estaDisponible(), true);
});

// Limpieza del segundo equipo creado
if (id2) {
  await peticion('DELETE', `/api/equipos/${id2}`);
}

console.log(`\n${ok} correctos, ${fallos} fallidos`);
process.exitCode = fallos > 0 ? 1 : 0;
