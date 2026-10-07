-- Diagnóstico SOLO LECTURA (no modifica nada).
-- Ejecutar completo en el SQL editor de Supabase y copiar TODO el resultado (columnas seccion + datos).
--   Ventas 30d:      c898dfd3-2283-4f78-bec2-792ec94b19c2
--   Stock por país:  cb108921-f5d5-4c6c-9f71-debeb5349958

WITH
pa AS (SELECT 'c898dfd3-2283-4f78-bec2-792ec94b19c2'::uuid AS id),
pb AS (SELECT 'cb108921-f5d5-4c6c-9f71-debeb5349958'::uuid AS id),
fam_a AS (  -- producto A + variantes hijas (por si las ventas están en las variantes)
  SELECT p.id, p.sku FROM public.productos p, pa WHERE p.id = pa.id OR p.parent_id = pa.id
),
win AS (SELECT (current_date - 29) AS d_from, current_date AS d_to)

SELECT '01_producto_A' AS seccion, jsonb_agg(to_jsonb(x)) AS datos FROM (
  SELECT p.id, p.sku, p.nombre, p.estado, p.parent_id, (p.id = pa.id) AS es_seleccionado
  FROM public.productos p, pa WHERE p.id = pa.id OR p.parent_id = pa.id
) x

UNION ALL SELECT '02_ventas_diarias_A_30d_por_fuente', jsonb_agg(to_jsonb(x)) FROM (
  SELECT v.producto_id, v.canal_venta, to_jsonb(v)->>'source' AS source, v.pais, SUM(v.unidades_vendidas) AS uds,
         MIN(v.fecha) AS desde, MAX(v.fecha) AS hasta
  FROM public.ventas_diarias v, win
  WHERE v.producto_id IN (SELECT id FROM fam_a) AND v.fecha BETWEEN win.d_from AND win.d_to
  GROUP BY 1,2,3,4 ORDER BY uds DESC
) x

UNION ALL SELECT '03_raw_fba_A_30d_por_marketplace', jsonb_agg(to_jsonb(x)) FROM (
  SELECT r.producto_id, r.sales_channel, r.raw->>'report_type' AS report_type,
         SUM(r.quantity) AS uds, COUNT(*) AS lineas, MIN(r.sale_date) AS desde, MAX(r.sale_date) AS hasta
  FROM public.amazon_fba_sales_daily_raw r, win
  WHERE r.producto_id IN (SELECT id FROM fam_a) AND r.sale_date BETWEEN win.d_from AND win.d_to
  GROUP BY 1,2,3 ORDER BY uds DESC
) x

UNION ALL SELECT '04_raw_fba_30d_SIN_ENLAZAR_mismo_sku', jsonb_agg(to_jsonb(x)) FROM (
  SELECT r.sku_original, r.sku_limpio, r.producto_id, r.sales_channel, SUM(r.quantity) AS uds, COUNT(*) AS lineas
  FROM public.amazon_fba_sales_daily_raw r, win
  WHERE r.sale_date BETWEEN win.d_from AND win.d_to
    AND (r.producto_id IS NULL OR r.producto_id NOT IN (SELECT id FROM fam_a))
    AND EXISTS (SELECT 1 FROM fam_a f
                WHERE upper(r.sku_limpio) LIKE upper(f.sku) || '%' OR upper(r.sku_original) LIKE '%' || upper(f.sku) || '%')
  GROUP BY 1,2,3,4 ORDER BY uds DESC LIMIT 50
) x

UNION ALL SELECT '06_frescura_ventas', jsonb_build_array(
  jsonb_build_object('max_sale_date_raw_fba', (SELECT MAX(sale_date) FROM public.amazon_fba_sales_daily_raw)),
  jsonb_build_object('max_fecha_ventas_diarias_por_source',
    (SELECT jsonb_object_agg(COALESCE(source,'(null)'), maxf) FROM
      (SELECT to_jsonb(v)->>'source' AS source, MAX(v.fecha) AS maxf FROM public.ventas_diarias v WHERE v.fecha > current_date - 120 GROUP BY 1) s))
)

UNION ALL SELECT '07_vista_stock_pais_B', jsonb_agg(to_jsonb(v) - 'dispositions') FROM (
  SELECT v.* FROM public.v_latest_fba_inventory_by_product_country v, pb WHERE v.producto_id = pb.id
) v

UNION ALL SELECT '08_ledger_B_ultima_fecha_detalle', jsonb_agg(
  to_jsonb(l) - 'raw' - 'id' - 'title' - 'producto_id' - 'created_at') FROM (
  SELECT l.* FROM public.amazon_fba_inventory_ledger_daily l, pb
  WHERE l.producto_id = pb.id
    AND l.snapshot_date = (SELECT MAX(snapshot_date) FROM public.amazon_fba_inventory_ledger_daily WHERE producto_id = pb.id)
) l

UNION ALL SELECT '09_ledger_B_fechas_recientes', jsonb_agg(to_jsonb(x)) FROM (
  SELECT l.snapshot_date, COUNT(DISTINCT l.location) AS ubicaciones,
         SUM(l.ending_warehouse_balance) FILTER (WHERE l.disposition = 'SELLABLE') AS sellable_total
  FROM public.amazon_fba_inventory_ledger_daily l, pb WHERE l.producto_id = pb.id
  GROUP BY 1 ORDER BY 1 DESC LIMIT 10
) x

UNION ALL SELECT '10_afn_por_pais_B_ultimo', jsonb_agg(to_jsonb(x)) FROM (
  SELECT f.marketplace_country, f.snapshot_date, SUM(f.stock_fba) AS stock_fba
  FROM public.fba_country_stock_daily f, pb
  WHERE f.producto_id = pb.id
    AND f.snapshot_date = (SELECT MAX(snapshot_date) FROM public.fba_country_stock_daily WHERE producto_id = pb.id)
  GROUP BY 1,2 ORDER BY 1
) x

UNION ALL SELECT '11_inventario_paises_legacy_B', jsonb_agg(to_jsonb(x)) FROM (
  SELECT i.pais, i.stock_fba, i.stock_fbm, i.stock_pais, i.updated_at
  FROM public.inventario_paises i, pb WHERE i.producto_id = pb.id ORDER BY i.pais
) x

UNION ALL SELECT '12_snapshot_spapi_B_operativo', jsonb_agg(to_jsonb(x) - 'raw') FROM (
  SELECT s.* FROM public.v_latest_amazon_fba_inventory_snapshot s, pb WHERE s.producto_id = pb.id
  ORDER BY s.snapshot_at DESC LIMIT 10
) x

UNION ALL SELECT '13_fbm_canonico_A_y_B', jsonb_agg(to_jsonb(x)) FROM (
  SELECT m.* FROM public.v_latest_amazon_fbm_inventory_by_product m
  WHERE m.producto_id IN ((SELECT id FROM pa), (SELECT id FROM pb))
) x;
