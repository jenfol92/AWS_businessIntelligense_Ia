-- Diagnostico de seguridad para upserts a ventas_diarias.
-- Objetivo: confirmar si la clave unica incluye source y si un upsert FBA
-- podria tocar filas legacy con source null.
-- Solo lectura.

-- 1) Constraints de ventas_diarias.
SELECT
  conname,
  contype,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.ventas_diarias'::regclass
ORDER BY conname;

-- 2) Indices de ventas_diarias.
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'ventas_diarias'
ORDER BY indexname;

-- 3) Posibles conflictos legacy vs nuevo source en el rango.
SELECT
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  tipo_cliente,
  marketplace_id,
  COUNT(*) AS filas,
  ARRAY_AGG(COALESCE(source, 'NULL')) AS sources,
  SUM(unidades_vendidas) AS unidades,
  SUM(ingresos_brutos) AS ingresos
FROM ventas_diarias
WHERE fecha >= '2026-06-02'
  AND fecha <= '2026-07-02'
  AND canal_venta = 'FBA'
GROUP BY
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  tipo_cliente,
  marketplace_id
HAVING COUNT(*) > 1
    OR BOOL_OR(source IS NULL)
ORDER BY fecha, pais;

-- 4) Comprobacion especifica legacy NULL vs source operativo FBA.
WITH scoped AS (
  SELECT
    producto_id,
    fecha,
    pais,
    canal_venta,
    moneda,
    tipo_cliente,
    marketplace_id,
    source,
    unidades_vendidas,
    ingresos_brutos
  FROM ventas_diarias
  WHERE fecha >= '2026-06-02'
    AND fecha <= '2026-07-02'
    AND canal_venta = 'FBA'
),
summary AS (
  SELECT
    COUNT(*) FILTER (WHERE source IS NULL) AS filas_source_null,
    COUNT(*) FILTER (WHERE source = 'spapi_fba_customer_shipment_sales') AS filas_source_operativo,
    SUM(unidades_vendidas) FILTER (WHERE source IS NULL) AS unidades_source_null,
    SUM(unidades_vendidas) FILTER (WHERE source = 'spapi_fba_customer_shipment_sales') AS unidades_source_operativo
  FROM scoped
),
matching_keys AS (
  SELECT
    legacy.producto_id,
    legacy.fecha,
    legacy.pais,
    legacy.canal_venta,
    legacy.moneda,
    legacy.tipo_cliente,
    legacy.marketplace_id,
    legacy.unidades_vendidas AS legacy_units,
    current_source.unidades_vendidas AS operativo_units,
    legacy.ingresos_brutos AS legacy_ingresos,
    current_source.ingresos_brutos AS operativo_ingresos
  FROM scoped legacy
  INNER JOIN scoped current_source
    ON current_source.producto_id = legacy.producto_id
   AND current_source.fecha = legacy.fecha
   AND current_source.pais = legacy.pais
   AND current_source.canal_venta = legacy.canal_venta
   AND current_source.moneda = legacy.moneda
   AND current_source.tipo_cliente = legacy.tipo_cliente
   AND current_source.marketplace_id = legacy.marketplace_id
   AND current_source.source = 'spapi_fba_customer_shipment_sales'
  WHERE legacy.source IS NULL
)
SELECT
  'resumen_source_null_vs_operativo' AS seccion,
  filas_source_null,
  filas_source_operativo,
  unidades_source_null,
  unidades_source_operativo,
  (SELECT COUNT(*) FROM matching_keys) AS claves_coincidentes_null_vs_operativo
FROM summary;

WITH scoped AS (
  SELECT
    producto_id,
    fecha,
    pais,
    canal_venta,
    moneda,
    tipo_cliente,
    marketplace_id,
    source,
    unidades_vendidas,
    ingresos_brutos
  FROM ventas_diarias
  WHERE fecha >= '2026-06-02'
    AND fecha <= '2026-07-02'
    AND canal_venta = 'FBA'
)
SELECT
  legacy.producto_id,
  legacy.fecha,
  legacy.pais,
  legacy.canal_venta,
  legacy.moneda,
  legacy.tipo_cliente,
  legacy.marketplace_id,
  legacy.unidades_vendidas AS legacy_units,
  current_source.unidades_vendidas AS operativo_units,
  legacy.ingresos_brutos AS legacy_ingresos,
  current_source.ingresos_brutos AS operativo_ingresos
FROM scoped legacy
INNER JOIN scoped current_source
  ON current_source.producto_id = legacy.producto_id
 AND current_source.fecha = legacy.fecha
 AND current_source.pais = legacy.pais
 AND current_source.canal_venta = legacy.canal_venta
 AND current_source.moneda = legacy.moneda
 AND current_source.tipo_cliente = legacy.tipo_cliente
 AND current_source.marketplace_id = legacy.marketplace_id
 AND current_source.source = 'spapi_fba_customer_shipment_sales'
WHERE legacy.source IS NULL
ORDER BY legacy.fecha, legacy.pais;
