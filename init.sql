CREATE SCHEMA IF NOT EXISTS practica_prestamos;

CREATE TABLE practica_prestamos.equipos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo varchar(20) NOT NULL UNIQUE
        CHECK (char_length(btrim(codigo)) BETWEEN 1 AND 20),
    nombre text NOT NULL
        CHECK (char_length(btrim(nombre)) > 0),
    categoria text NOT NULL
        CHECK (char_length(btrim(categoria)) > 0),
    disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE practica_prestamos.usuarios (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre text NOT NULL
        CHECK (char_length(btrim(nombre)) > 0)
);

CREATE TABLE practica_prestamos.prestamos (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipo_id integer NOT NULL
        REFERENCES practica_prestamos.equipos (id),
    usuario_id integer NOT NULL
        REFERENCES practica_prestamos.usuarios (id),
    fecha_prestamo timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_devolucion timestamptz,
    CHECK (
        fecha_devolucion IS NULL
        OR fecha_devolucion >= fecha_prestamo
    )
);

CREATE UNIQUE INDEX prestamo_activo_por_equipo
    ON practica_prestamos.prestamos (equipo_id)
    WHERE fecha_devolucion IS NULL;

INSERT INTO practica_prestamos.equipos
    (codigo, nombre, categoria, disponible)
VALUES
    ('PORT-001', 'Portátil HP ProBook', 'Portátil', true),
    ('PORT-002', 'Portátil Lenovo ThinkPad', 'Portátil', true),
    ('PORT-003', 'Portátil Dell Latitude', 'Portátil', true),
    ('TAB-001', 'Tableta Samsung Galaxy Tab', 'Tableta', true),
    ('TAB-002', 'Tableta Apple iPad', 'Tableta', true),
    ('PROY-001', 'Proyector Epson EB-X49', 'Proyector', true),
    ('PROY-002', 'Proyector BenQ MX560', 'Proyector', true),
    ('CAM-001', 'Cámara Canon EOS', 'Cámara', true),
    ('MIC-001', 'Micrófono inalámbrico', 'Audio', true),
    ('AUR-001', 'Auriculares Logitech Zone', 'Audio', true);

INSERT INTO practica_prestamos.usuarios (nombre)
VALUES
    ('Ana García'),
    ('Carlos Martínez'),
    ('Lucía Fernández');