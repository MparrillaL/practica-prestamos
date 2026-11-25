# Práctica de préstamos

## Versiones utilizadas

- Node.js 24
- PostgreSQL 18
- Express 5
- pg 8
- EJS 3
- Docker con Docker Compose

## Instalación

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` como `.env` y configura las credenciales
   (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` y `PORT`).

## Base de datos con Docker

1. Inicia PostgreSQL con `docker compose up -d`.
2. Comprueba el estado con `docker compose ps`.
3. Conecta con `docker compose exec db psql -U dwes_app -d dwes`.

### Inicialización de los datos

`init.sql` se ejecuta automáticamente **solo cuando el volumen está vacío**
(la primera vez). Para reiniciar los datos y volver al estado inicial:

```
docker compose down -v
docker compose up -d
```

> **Aviso:** `down -v` elimina el volumen y **borra todos los datos**.

## Arranque de la aplicación

```
npm start
```

La aplicación escucha en `http://127.0.0.1:3000` (o el `PORT` del `.env`).
Si PostgreSQL no está disponible, termina con un mensaje y código de salida 1.

## Rutas

### Vistas

| Ruta | Descripción |
|---|---|
| `GET /equipos` | Listado paginado (5 por página). Filtros opcionales por query string: `q` (texto en el nombre), `categoria`, `disponible` (`true`/`false`), `orden` (`codigo`/`nombre`) y `pagina`. |
| `GET /equipos/:id` | Ficha del equipo: estado (disponible o a quién está prestado) e historial de préstamos. 400 si el id no es válido, 404 si no existe. |

### API (JSON)

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/equipos` | `{ "codigo", "nombre", "categoria" }` | **201** + cabecera `Location` y el equipo · 400 datos no válidos · 409 código repetido |
| `PUT /api/equipos/:id` | `{ "codigo", "nombre", "categoria" }` | **200** con el equipo · 400 · 404 · 409 código repetido |
| `DELETE /api/equipos/:id` | — | **204** sin cuerpo · 404 · 409 si el equipo tiene préstamos |
| `POST /api/prestamos` | `{ "equipoId", "usuarioId" }` (enteros positivos) | **201** con el préstamo · 400 datos no válidos, equipo o usuario inexistente · 409 equipo no disponible |
| `POST /api/prestamos/:id/devolucion` | — | **200** con el préstamo devuelto · 400 id no válido · 404 préstamo inexistente · 409 ya devuelto |

Reglas comunes:

- `codigo`: 1–20 caracteres entre mayúsculas, dígitos y guion.
- `nombre` y `categoria`: texto no vacío de hasta 80 caracteres.
- `disponible` **nunca** se modifica por la API de equipos: solo cambia al
  prestar o devolver.
- Un JSON mal formado devuelve 400 y un cuerpo de más de 10 kB, 413.
- Los errores inesperados devuelven un 500 con un mensaje genérico.

## Ejemplos con `curl`

Ejecuta estos ejemplos con la aplicación arrancada en `http://127.0.0.1:3000`.
Los ejemplos de préstamos y de borrado dependen del estado de la base de datos;
consulta [Datos iniciales](#datos-iniciales) para volver al estado limpio.

### Préstamos y devoluciones

```bash
# Prestar el equipo 1 a Ana García → 201
curl -i -X POST http://127.0.0.1:3000/api/prestamos -H "Content-Type: application/json" -d '{"equipoId":1,"usuarioId":1}'

# Repetir el mismo préstamo → 409 (el equipo ya no está disponible)
curl -i -X POST http://127.0.0.1:3000/api/prestamos -H "Content-Type: application/json" -d '{"equipoId":1,"usuarioId":1}'

# Usuario inexistente → 400; el equipo 2 sigue «Disponible» (rollback)
curl -i -X POST http://127.0.0.1:3000/api/prestamos -H "Content-Type: application/json" -d '{"equipoId":2,"usuarioId":99}'

# Devolver el préstamo 1 → 200; repetir → 409
curl -i -X POST http://127.0.0.1:3000/api/prestamos/1/devolucion
curl -i -X POST http://127.0.0.1:3000/api/prestamos/1/devolucion
```

### Préstamos simultáneos

Lanza seis préstamos del mismo equipo a la vez. Debe salir un `201` y cinco
`409`:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/prestamos \
    -H "Content-Type: application/json" -d '{"equipoId":3,"usuarioId":1}' &
done; wait
```

### Equipos

Con los datos iniciales, la nueva alta tendrá el id 11:

```bash
# Alta → 201 con cabecera Location (/equipos/11)
curl -i -X POST http://127.0.0.1:3000/api/equipos -H "Content-Type: application/json" -d '{"codigo":"PORT-004","nombre":"Portátil Asus","categoria":"Portátil"}'

# Código repetido → 409
curl -i -X POST http://127.0.0.1:3000/api/equipos -H "Content-Type: application/json" -d '{"codigo":"PORT-004","nombre":"Otro portátil","categoria":"Portátil"}'

# JSON mal formado → 400
curl -i -X POST http://127.0.0.1:3000/api/equipos -H "Content-Type: application/json" -d '{mal'

# Modificación → 200 (usa el id que devolvió Location)
curl -i -X PUT http://127.0.0.1:3000/api/equipos/11 -H "Content-Type: application/json" -d '{"codigo":"PORT-004","nombre":"Portátil Asus ZenBook","categoria":"Portátil"}'

# Borrar un equipo con historial de préstamos → 409
curl -i -X DELETE http://127.0.0.1:3000/api/equipos/1

# Borrar el equipo nuevo → 204; repetir → 404
curl -i -X DELETE http://127.0.0.1:3000/api/equipos/11
curl -i -X DELETE http://127.0.0.1:3000/api/equipos/11
```

## Datos iniciales

`init.sql` crea 10 equipos en 5 categorías (Portátil, Tableta, Proyector,
Cámara y Audio) y 3 usuarios con ids 1 a 3. No hay préstamos al empezar.

## Pruebas

El script `prueba.mjs` usa `fetch` contra la aplicación, que debe estar
arrancada (`npm start`). Se ejecuta con `npm run prueba` y comprueba 44 casos.
Crea equipos con código `TEST-…` y préstamos de prueba que **no se pueden
borrar** (un equipo con historial devuelve 409), así que conviene reiniciar
los datos con `docker compose down -v` tras ejecutarlo.

Resultados de la última ejecución (44 correctos, 0 fallidos):

| Caso | Petición | Esperado | Obtenido |
|---|---|---|---|
| Alta de equipo | `POST /api/equipos` con datos válidos | 201, `Location: /equipos/<id>` y `disponible: true` | 201, `Location` correcto, `disponible: true` |
| Alta con código repetido | `POST /api/equipos` con un código existente | 409 | 409 |
| Alta con datos no válidos | `POST /api/equipos` con código en minúsculas, nombre vacío, tipos erróneos, JSON mal formado, etc. | 400 | 400 en todos los casos |
| Modificación | `PUT /api/equipos/:id` | 200 y `disponible` sin cambios | 200, `disponible` sin cambios |
| Modificación de un id inexistente | `PUT /api/equipos/2147483647` | 404 | 404 |
| Filtros (navegador) | `GET /equipos?q=port` | 3 equipos | 3 equipos |
| | `GET /equipos?categoria=Audio` | 2 equipos | 2 equipos |
| | `GET /equipos?disponible=false` | mensaje «No hay equipos…» | mensaje «No hay equipos…» |
| | `GET /equipos?orden=nombre&pagina=2` | 5 equipos, «Página 2 de 2» | 5 equipos, «Página 2 de 2 (10 equipos)» |
| Borrado | `DELETE /api/equipos/:id` | 204 sin cuerpo; repetido, 404 | 204 sin cuerpo; repetido, 404 |
| Borrado con historial | `DELETE /api/equipos/:id` de un equipo con préstamos | 409 | 409 |
| Préstamo correcto | `POST /api/prestamos` con equipo disponible y usuario 1 | 201 y el equipo pasa a «Prestado» | 201, equipo «Prestado» |
| Préstamo duplicado | `POST /api/prestamos` del mismo equipo ya prestado | 409 | 409 |
| Rollback | `POST /api/prestamos` con usuario inexistente | 400 y el equipo sigue «Disponible» | 400, equipo «Disponible» (el `UPDATE` se deshizo) |
| Devolución | `POST /api/prestamos/:id/devolucion` | 200 y equipo «Disponible»; repetida, 409; inexistente, 404 | 200, equipo «Disponible»; repetida, 409; inexistente, 404 |
| Simultaneidad (préstamos) | 6 `POST /api/prestamos` a la vez del mismo equipo | un 201 y cinco 409 | un 201 y cinco 409 |
| Simultaneidad (devoluciones) | 2 devoluciones a la vez del mismo préstamo | un 200 y un 409 | un 200 y un 409 |
| Pool de conexiones | 8 préstamos fallidos seguidos y uno correcto | sin agotar el pool (máx. 5) | sin problemas |

## Limitaciones conocidas

- **No hay autenticación:** `usuarioId` llega en el cuerpo de la petición. En
  una aplicación real saldría de la sesión del usuario.
- **`disponible` es un dato redundante** con los préstamos activos. Se
  mantiene coherente actualizándolo dentro de una transacción junto con el
  préstamo.
- **Paginación en dos consultas:** el `count` y el `SELECT` son consultas
  separadas, así que el total y la página podrían diferir por un instante si
  alguien escribe entre una y otra.
- **Pruebas con un script `fetch`:** no se usa un framework de tests, y el
  script deja datos de prueba en la base.

## Enlace chat IA
https://claude.ai/share/d0398102-2f59-4511-a8ce-80afb4a55116