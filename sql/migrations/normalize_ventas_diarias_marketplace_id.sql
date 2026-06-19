-- Normalización segura: marketplace_id null → ID Amazon por país
--
-- IMPORTANTE:
--   1. Ejecutar primero sql/diagnostics/ventas_diarias_marketplace_null_dry_run.sql
--   2. Revisar conteos merge vs update
--   3. Ejecutar manualmente en ventana de mantenimiento
--   4. NO se ejecuta automáticamente desde la app
--
-- Países soportados: DE, ES, FR, GB, IT, PL, SE
-- No toca LU ni otros países fuera del mapeo.

BEGIN;

-- ── Paso 0: fusionar filas null duplicadas entre sí (mismo grain sin marketplace) ──
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
null_dup_groups AS (
  SELECT
    vd.producto_id,
    vd.fecha,
    vd.pais,
    vd.canal_venta,
    vd.moneda,
    vd.tipo_cliente,
    MIN(vd.id) AS keep_id,
    ARRAY_AGG(vd.id ORDER BY vd.id) AS all_ids
  FROM public.ventas_diarias vd
  INNER JOIN marketplace_map mm ON upper(trim(vd.pais)) = mm.pais
  WHERE vd.marketplace_id IS NULL OR btrim(vd.marketplace_id) = ''
  GROUP BY
    vd.producto_id,
    vd.fecha,
    vd.pais,
    vd.canal_venta,
    vd.moneda,
    vd.tipo_cliente
  HAVING COUNT(*) > 1
),
dup_totals AS (
  SELECT
    g.keep_id,
    SUM(COALESCE(v.unidades_vendidas, 0)) AS unidades_vendidas,
    SUM(COALESCE(v.ingresos_brutos, 0)) AS ingresos_brutos,
    SUM(COALESCE(v.publicidad_gasto_ads, 0)) AS publicidad_gasto_ads,
    SUM(COALESCE(v.iva_pagado_cuota, 0)) AS iva_pagado_cuota,
    SUM(COALESCE(v.ingresos_netos_sin_iva, 0)) AS ingresos_netos_sin_iva,
    SUM(COALESCE(v.comisiones_amazon_referral, 0)) AS comisiones_amazon_referral,
    SUM(COALESCE(v.comisiones_amazon_fba, 0)) AS comisiones_amazon_fba,
    SUM(COALESCE(v.coste_devoluciones, 0)) AS coste_devoluciones,
    SUM(COALESCE(v.beneficio_operativo_neto, 0)) AS beneficio_operativo_neto
  FROM null_dup_groups g
  INNER JOIN public.ventas_diarias v ON v.id = ANY(g.all_ids)
  GROUP BY g.keep_id
)
UPDATE public.ventas_diarias t
SET
  unidades_vendidas = d.unidades_vendidas,
  ingresos_brutos = d.ingresos_brutos,
  publicidad_gasto_ads = d.publicidad_gasto_ads,
  iva_pagado_cuota = d.iva_pagado_cuota,
  ingresos_netos_sin_iva = d.ingresos_netos_sin_iva,
  comisiones_amazon_referral = d.comisiones_amazon_referral,
  comisiones_amazon_fba = d.comisiones_amazon_fba,
  coste_devoluciones = d.coste_devoluciones,
  beneficio_operativo_neto = d.beneficio_operativo_neto
FROM dup_totals d
WHERE t.id = d.keep_id;

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
null_dup_groups AS (
  SELECT
    vd.producto_id,
    vd.fecha,
    vd.pais,
    vd.canal_venta,
    vd.moneda,
    vd.tipo_cliente,
    MIN(vd.id) AS keep_id,
    ARRAY_AGG(vd.id ORDER BY vd.id) AS all_ids
  FROM public.ventas_diarias vd
  INNER JOIN marketplace_map mm ON upper(trim(vd.pais)) = mm.pais
  WHERE vd.marketplace_id IS NULL OR btrim(vd.marketplace_id) = ''
  GROUP BY
    vd.producto_id,
    vd.fecha,
    vd.pais,
    vd.canal_venta,
    vd.moneda,
    vd.tipo_cliente
  HAVING COUNT(*) > 1
)
DELETE FROM public.ventas_diarias vd
USING null_dup_groups g
WHERE vd.id = ANY(g.all_ids)
  AND vd.id <> g.keep_id;

-- ── Paso 1: fusionar null → fila destino con marketplace_id correcto ──
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
  SELECT
    vd.*,
    mm.marketplace_id AS suggested_marketplace_id
  FROM public.ventas_diarias vd
  INNER JOIN marketplace_map mm ON upper(trim(vd.pais)) = mm.pais
  WHERE vd.marketplace_id IS NULL OR btrim(vd.marketplace_id) = ''
),
merge_targets AS (
  SELECT
    e.id AS source_id,
    t.id AS target_id
  FROM eligible_null e
  INNER JOIN public.ventas_diarias t
    ON t.producto_id = e.producto_id
   AND t.fecha = e.fecha
   AND t.pais = e.pais
   AND t.canal_venta = e.canal_venta
   AND t.moneda = e.moneda
   AND t.tipo_cliente = e.tipo_cliente
   AND t.marketplace_id = e.suggested_marketplace_id
   AND t.id <> e.id
),
merged_sources AS (
  UPDATE public.ventas_diarias t
  SET
    unidades_vendidas = COALESCE(t.unidades_vendidas, 0) + COALESCE(s.unidades_vendidas, 0),
    ingresos_brutos = COALESCE(t.ingresos_brutos, 0) + COALESCE(s.ingresos_brutos, 0),
    publicidad_gasto_ads = COALESCE(t.publicidad_gasto_ads, 0) + COALESCE(s.publicidad_gasto_ads, 0),
    iva_pagado_cuota = COALESCE(t.iva_pagado_cuota, 0) + COALESCE(s.iva_pagado_cuota, 0),
    ingresos_netos_sin_iva = COALESCE(t.ingresos_netos_sin_iva, 0) + COALESCE(s.ingresos_netos_sin_iva, 0),
    comisiones_amazon_referral = COALESCE(t.comisiones_amazon_referral, 0) + COALESCE(s.comisiones_amazon_referral, 0),
    comisiones_amazon_fba = COALESCE(t.comisiones_amazon_fba, 0) + COALESCE(s.comisiones_amazon_fba, 0),
    coste_devoluciones = COALESCE(t.coste_devoluciones, 0) + COALESCE(s.coste_devoluciones, 0),
    beneficio_operativo_neto = COALESCE(t.beneficio_operativo_neto, 0) + COALESCE(s.beneficio_operativo_neto, 0),
    source = COALESCE(t.source, s.source)
  FROM merge_targets mt
  INNER JOIN public.ventas_diarias s ON s.id = mt.source_id
  WHERE t.id = mt.target_id
  RETURNING mt.source_id
)
DELETE FROM public.ventas_diarias vd
WHERE vd.id IN (SELECT source_id FROM merged_sources);

-- ── Paso 2: actualizar null restantes (sin fila destino) ──
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
)
UPDATE public.ventas_diarias vd
SET marketplace_id = mm.marketplace_id
FROM marketplace_map mm
WHERE (vd.marketplace_id IS NULL OR btrim(vd.marketplace_id) = '')
  AND upper(trim(vd.pais)) = mm.pais
  AND NOT EXISTS (
    SELECT 1
    FROM public.ventas_diarias t
    WHERE t.producto_id = vd.producto_id
      AND t.fecha = vd.fecha
      AND t.pais = vd.pais
      AND t.canal_venta = vd.canal_venta
      AND t.moneda = vd.moneda
      AND t.tipo_cliente = vd.tipo_cliente
      AND t.marketplace_id = mm.marketplace_id
      AND t.id <> vd.id
  );

COMMIT;

-- ── Validación post-migración (ejecutar después del COMMIT) ──

-- Resto null por país/canal
SELECT
  pais,
  canal_venta,
  marketplace_id,
  COUNT(*) AS filas,
  SUM(COALESCE(unidades_vendidas, 0)) AS unidades,
  MIN(fecha) AS desde,
  MAX(fecha) AS hasta
FROM public.ventas_diarias
WHERE marketplace_id IS NULL OR btrim(marketplace_id) = ''
GROUP BY pais, canal_venta, marketplace_id
ORDER BY unidades DESC;

-- ALAIA
SELECT
  p.sku,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  MIN(vd.fecha) AS desde,
  MAX(vd.fecha) AS hasta,
  SUM(vd.unidades_vendidas) AS unidades,
  SUM(vd.ingresos_brutos) AS ingresos
FROM public.ventas_diarias vd
JOIN public.productos p ON p.id = vd.producto_id
WHERE p.sku = '8436616610104'
GROUP BY p.sku, vd.pais, vd.canal_venta, vd.marketplace_id
ORDER BY hasta DESC;

-- Grains duplicados restantes (debe devolver 0 filas)
SELECT
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  tipo_cliente,
  COUNT(*) AS filas
FROM public.ventas_diarias
GROUP BY producto_id, fecha, pais, canal_venta, moneda, tipo_cliente
HAVING COUNT(*) > 1
ORDER BY fecha DESC
LIMIT 100;
