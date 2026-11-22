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

// Limpieza del segundo equipo creado
if (id2) {
  await peticion('DELETE', `/api/equipos/${id2}`);
}

console.log(`\n${ok} correctos, ${fallos} fallidos`);
process.exitCode = fallos > 0 ? 1 : 0;
