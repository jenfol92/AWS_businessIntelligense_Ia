-- Dry-run: ventas_diarias con marketplace_id null o vacío
-- Ejecutar ANTES de sql/migrations/normalize_ventas_diarias_marketplace_id.sql

-- 1) Resumen por país/canal
SELECT
  pais,
  canal_venta,
  COUNT(*) AS filas,
  SUM(COALESCE(unidades_vendidas, 0)) AS unidades,
  MIN(fecha) AS desde,
  MAX(fecha) AS hasta
FROM public.ventas_diarias
WHERE marketplace_id IS NULL OR btrim(marketplace_id) = ''
GROUP BY pais, canal_venta
ORDER BY unidades DESC;

-- 2) Grains duplicados: fila null + fila con marketplace_id (riesgo de doble conteo)
SELECT
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  tipo_cliente,
  COUNT(*) AS filas,
  COUNT(*) FILTER (
    WHERE marketplace_id IS NULL OR btrim(marketplace_id) = ''
  ) AS filas_null,
  COUNT(*) FILTER (
    WHERE marketplace_id IS NOT NULL AND btrim(marketplace_id) <> ''
  ) AS filas_con_marketplace,
  SUM(COALESCE(unidades_vendidas, 0)) AS unidades
FROM public.ventas_diarias
GROUP BY producto_id, fecha, pais, canal_venta, moneda, tipo_cliente
HAVING COUNT(*) > 1
   AND COUNT(*) FILTER (
     WHERE marketplace_id IS NULL OR btrim(marketplace_id) = ''
   ) > 0
   AND COUNT(*) FILTER (
     WHERE marketplace_id IS NOT NULL AND btrim(marketplace_id) <> ''
   ) > 0
ORDER BY fecha DESC
LIMIT 300;

-- 3) Simulación: filas null que se fusionarían (tienen destino con marketplace sugerido)
WITH marketplace_map AS (
  SELECT * FROM (
    VALUES
      ('DE', 'A1PA6795UKMFR9'),
      ('ES', 'A1RKKUPIHCS9HS'),
      ('FR', 'A13V1IB3VIYZZH'),
      ('GB', 'A1F8U78D6W0GOS'),
      ('IT', 'APJ6JRA9NG5V4'),
      ('PL', 'A1C37XSU9S960A'),
      ('SE', 'A2NODRK35VY8IU')
  ) AS m(pais, marketplace_id)
),
eligible_null AS (
  SELECT vd.*
  FROM public.ventas_diarias vd
  INNER JOIN marketplace_map mm ON upper(trim(vd.pais)) = mm.pais
  WHERE vd.marketplace_id IS NULL OR btrim(vd.marketplace_id) = ''
)
SELECT
  'merge_into_existing' AS accion,
  COUNT(*) AS filas_null,
  SUM(COALESCE(e.unidades_vendidas, 0)) AS unidades
FROM eligible_null e
WHERE EXISTS (
  SELECT 1
  FROM public.ventas_diarias t
  INNER JOIN marketplace_map mm ON upper(trim(e.pais)) = mm.pais
  WHERE t.producto_id = e.producto_id
    AND t.fecha = e.fecha
    AND t.pais = e.pais
    AND t.canal_venta = e.canal_venta
    AND t.moneda = e.moneda
    AND t.tipo_cliente = e.tipo_cliente
    AND t.marketplace_id = mm.marketplace_id
    AND t.id <> e.id
)

UNION ALL

SELECT
  'update_marketplace_only' AS accion,
  COUNT(*) AS filas_null,
  SUM(COALESCE(e.unidades_vendidas, 0)) AS unidades
FROM eligible_null e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.ventas_diarias t
  INNER JOIN marketplace_map mm ON upper(trim(e.pais)) = mm.pais
  WHERE t.producto_id = e.producto_id
    AND t.fecha = e.fecha
    AND t.pais = e.pais
    AND t.canal_venta = e.canal_venta
    AND t.moneda = e.moneda
    AND t.tipo_cliente = e.tipo_cliente
    AND t.marketplace_id = mm.marketplace_id
    AND t.id <> e.id
);

-- 4) Países null fuera del mapeo (no se tocarán)
SELECT
  pais,
  canal_venta,
  COUNT(*) AS filas,
  SUM(COALESCE(unidades_vendidas, 0)) AS unidades
FROM public.ventas_diarias
WHERE (marketplace_id IS NULL OR btrim(marketplace_id) = '')
  AND upper(trim(pais)) NOT IN ('DE', 'ES', 'FR', 'GB', 'IT', 'PL', 'SE')
GROUP BY pais, canal_venta
ORDER BY unidades DESC;
