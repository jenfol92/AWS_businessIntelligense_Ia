-- Diagnóstico: inventario_paises vs último snapshot FBA ledger
-- Ejemplo: WHERE p.sku = '8436616610104'

SELECT
  p.id,
  p.sku,
  i.pais,
  i.stock_fba AS stock_fba_app,
  i.stock_fbm AS stock_fbm_app,
  COALESCE(i.stock_fba, 0) + COALESCE(i.stock_fbm, 0) AS stock_total_app,
  i.updated_at AS stock_app_updated_at,
  latest.snapshot_date AS latest_fba_snapshot_date,
  latest.stock_fba_sellable AS latest_fba_sellable,
  latest.stock_fba_total AS latest_fba_total
FROM public.productos p
LEFT JOIN public.inventario_paises i ON i.producto_id = p.id
LEFT JOIN LATERAL (
  SELECT
    f.snapshot_date,
    SUM(f.stock_sellable)::bigint AS stock_fba_sellable,
    SUM(f.stock_total)::bigint AS stock_fba_total
  FROM public.v_product_fba_stock_daily f
  WHERE f.producto_id = p.id
    AND f.snapshot_date = (
      SELECT MAX(f2.snapshot_date)
      FROM public.v_product_fba_stock_daily f2
      WHERE f2.producto_id = p.id
    )
  GROUP BY f.snapshot_date
) latest ON TRUE
WHERE p.sku = '8436616610104'
ORDER BY i.pais;

-- Resumen global por producto (sin desglose país)
SELECT
  p.sku,
  SUM(COALESCE(i.stock_fba, 0)) AS stock_fba_app_total,
  SUM(COALESCE(i.stock_fbm, 0)) AS stock_fbm_app_total,
  MAX(latest.stock_fba_sellable) AS latest_fba_sellable,
  MAX(latest.snapshot_date) AS latest_fba_snapshot_date
FROM public.productos p
LEFT JOIN public.inventario_paises i ON i.producto_id = p.id
LEFT JOIN LATERAL (
  SELECT
    f.snapshot_date,
    SUM(f.stock_sellable)::bigint AS stock_fba_sellable
  FROM public.v_product_fba_stock_daily f
  WHERE f.producto_id = p.id
    AND f.snapshot_date = (
      SELECT MAX(f2.snapshot_date)
      FROM public.v_product_fba_stock_daily f2
      WHERE f2.producto_id = p.id
    )
  GROUP BY f.snapshot_date
) latest ON TRUE
WHERE p.sku = '8436616610104'
GROUP BY p.sku;

-- Trazabilidad: de dónde pudo salir inventario_paises (contenedor entregado, etc.)
SELECT
  i.pais,
  i.stock_fba,
  i.stock_fbm,
  i.updated_at AS stock_app_updated_at,
  csa.cantidad AS ultimo_incremento_cantidad,
  csa.canal AS ultimo_incremento_canal,
  csa.fuente AS ultimo_incremento_fuente,
  csa.aplicado_at AS ultimo_incremento_at,
  csa.contenedor_id
FROM public.productos p
JOIN public.inventario_paises i ON i.producto_id = p.id
LEFT JOIN LATERAL (
  SELECT cantidad, canal, fuente, aplicado_at, contenedor_id
  FROM public.contenedor_stock_aplicado c
  WHERE c.producto_id = p.id
    AND c.pais = i.pais
    AND c.revertido_at IS NULL
  ORDER BY c.aplicado_at DESC
  LIMIT 1
) csa ON TRUE
WHERE p.sku = '8436616610104'
ORDER BY i.pais;
