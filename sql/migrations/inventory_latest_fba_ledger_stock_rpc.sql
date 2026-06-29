CREATE OR REPLACE FUNCTION public.get_latest_fba_ledger_stock_by_products(product_ids uuid[])
RETURNS TABLE (
  producto_id uuid,
  snapshot_date date,
  stock_sellable integer,
  stock_total integer
)
LANGUAGE sql
STABLE
AS $$
  WITH latest_day AS (
    SELECT
      v.producto_id,
      MAX(v.snapshot_date) AS snapshot_date
    FROM public.v_product_fba_stock_daily v
    WHERE v.producto_id = ANY(product_ids)
    GROUP BY v.producto_id
  )
  SELECT
    v.producto_id,
    v.snapshot_date,
    COALESCE(SUM(v.stock_sellable), 0)::integer AS stock_sellable,
    COALESCE(SUM(v.stock_total), 0)::integer AS stock_total
  FROM public.v_product_fba_stock_daily v
  INNER JOIN latest_day ld
    ON ld.producto_id = v.producto_id
   AND ld.snapshot_date = v.snapshot_date
  GROUP BY v.producto_id, v.snapshot_date;
$$;

GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO service_role;
