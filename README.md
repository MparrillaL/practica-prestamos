# Práctica de préstamos

## Versiones utilizadas

- Node.js 24
- PostgreSQL 18
- Express 5
- pg 8
- EJS 3
- Docker con Docker Compose

## Puesta en marcha

1. Instala las dependencias con `npm install`.
2. Copia `.env.example` como `.env` y configura las credenciales.
3. Inicia PostgreSQL con `docker compose up -d`.
4. Comprueba el estado con `docker compose ps`.
5. Conecta con `docker compose exec db psql -U dwes_app -d dwes`.
6. Inicia la aplicación con `npm start`.

`init.sql` se ejecutará únicamente al crear el volumen por primera vez.

## Nota sobre Docker

Este entorno todavía no permite verificar `psql`, porque el PC actual no
ofrece el soporte de virtualización que Docker Desktop necesita. La
configuración de Compose se validará en un equipo con virtualización
habilitada.
