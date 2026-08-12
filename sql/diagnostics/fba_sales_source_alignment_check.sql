-- Diagnostico de alineacion de source FBA Sales -> ventas_diarias.
-- No escribe datos.

WITH params AS (
  SELECT
    current_date - INTERVAL '90 days' AS start_date,
    'sp-api-fba-sales'::text AS old_source,
    'spapi_fba_customer_shipment_sales'::text AS expected_source
),
ventas_fba_by_source AS (
  SELECT
    vd.source,
    COALESCE(vd.canal_venta, 'FBA') AS canal_venta,
    COUNT(*) AS filas,
    COALESCE(SUM(COALESCE(vd.unidades_vendidas, 0)), 0) AS unidades,
    COALESCE(SUM(COALESCE(vd.ingresos_brutos, 0)), 0) AS ingresos
  FROM public.ventas_diarias vd
  CROSS JOIN params p
  WHERE vd.fecha >= p.start_date
    AND COALESCE(vd.canal_venta, 'FBA') = 'FBA'
  GROUP BY vd.source, COALESCE(vd.canal_venta, 'FBA')
),
raw_fba AS (
  SELECT
    COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN') AS ship_to_country,
    COUNT(*) AS filas_raw,
    COALESCE(SUM(COALESCE(r.quantity, 0)), 0) AS unidades_raw,
    COUNT(*) FILTER (WHERE r.amount IS NOT NULL) AS filas_con_amount,
    COUNT(*) FILTER (WHERE COALESCE(r.amount, 0) > 0) AS filas_con_amount_positivo,
    COALESCE(SUM(COALESCE(r.amount, 0)), 0) AS amount_total
  FROM public.amazon_fba_sales_daily_raw r
  CROSS JOIN params p
  WHERE r.producto_id IS NOT NULL
    AND r.sale_date >= p.start_date
  GROUP BY COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN')
),
source_flags AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM public.ventas_diarias vd, params p
      WHERE vd.source = p.old_source
        AND COALESCE(vd.canal_venta, 'FBA') = 'FBA'
    ) AS existe_source_antiguo,
    EXISTS (
      SELECT 1
      FROM public.ventas_diarias vd, params p
      WHERE vd.source = p.expected_source
        AND COALESCE(vd.canal_venta, 'FBA') = 'FBA'
    ) AS existe_source_correcto
)
SELECT
  '01_source_flags' AS seccion,
  jsonb_build_object(
    'old_source', p.old_source,
    'expected_source', p.expected_source,
    'existe_source_antiguo', f.existe_source_antiguo,
    'existe_source_correcto', f.existe_source_correcto
  ) AS resultado
FROM params p
CROSS JOIN source_flags f

UNION ALL

SELECT
  '02_ventas_diarias_fba_por_source' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v.unidades DESC), '[]'::jsonb) AS resultado
FROM ventas_fba_by_source v

UNION ALL

SELECT
  '03_amazon_fba_sales_daily_raw_amount_quantity' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.unidades_raw DESC), '[]'::jsonb) AS resultado
FROM raw_fba r

UNION ALL

SELECT
  '04_source_antiguo_sp_api_fba_sales' AS seccion,
  COALESCE(
    (
      SELECT to_jsonb(v)
      FROM ventas_fba_by_source v, params p
      WHERE v.source = p.old_source
      LIMIT 1
    ),
    jsonb_build_object('source', (SELECT old_source FROM params), 'filas', 0, 'unidades', 0)
  ) AS resultado

UNION ALL

SELECT
  '05_source_correcto_spapi_fba_customer_shipment_sales' AS seccion,
  COALESCE(
    (
      SELECT to_jsonb(v)
      FROM ventas_fba_by_source v, params p
      WHERE v.source = p.expected_source
      LIMIT 1
    ),
    jsonb_build_object('source', (SELECT expected_source FROM params), 'filas', 0, 'unidades', 0)
  ) AS resultado;
