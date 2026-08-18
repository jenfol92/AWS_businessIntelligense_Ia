-- Physical FBA location repair over the existing canonical Inventory Ledger.
-- No data rewrite: FC-like codes remain provenance and are never exposed as countries.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_amazon_physical_country(
  raw_location text,
  raw_location_country text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(trim(COALESCE(raw_location_country, ''))) = 'UK' THEN 'GB'
    WHEN upper(trim(COALESCE(raw_location_country, ''))) ~ '^[A-Z]{2}$'
      THEN upper(trim(raw_location_country))
    WHEN upper(trim(COALESCE(raw_location, ''))) = 'UK' THEN 'GB'
    WHEN upper(trim(COALESCE(raw_location, ''))) ~ '^[A-Z]{2}$'
      THEN upper(trim(raw_location))
    ELSE 'UNKNOWN_LOCATION'
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_amazon_fulfillment_center(
  raw_location text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(upper(trim(COALESCE(raw_location, ''))), '') IS NULL THEN NULL
    WHEN upper(trim(raw_location)) = 'UK' THEN NULL
    WHEN upper(trim(raw_location)) ~ '^[A-Z]{2}$' THEN NULL
    ELSE upper(trim(raw_location))
  END;
$$;

CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_country AS
WITH latest_day AS (
  SELECT producto_id, MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id IS NOT NULL
  GROUP BY producto_id
),
canonical AS (
  SELECT DISTINCT ON (
    l.producto_id,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition
  )
    l.producto_id,
    public.normalize_amazon_physical_country(l.location, l.location_country) AS pais,
    public.normalize_amazon_fulfillment_center(l.location) AS fulfillment_center,
    l.location AS raw_location,
    l.snapshot_date,
    l.disposition,
    COALESCE(NULLIF(upper(trim(l.condition_type)), ''), 'UNKNOWN') AS condition_type,
    COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
    l.updated_at,
    l.fnsku,
    l.asin,
    l.msku_aliases
  FROM public.amazon_fba_inventory_ledger_daily l
  INNER JOIN latest_day d
    ON d.producto_id = l.producto_id
   AND d.snapshot_date = l.snapshot_date
  ORDER BY
    l.producto_id,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition,
    l.updated_at DESC
),
country_totals AS (
  SELECT
    producto_id,
    pais,
    snapshot_date,
    MAX(updated_at) AS last_imported_at,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type = 'NEWITEM'
    )::bigint AS stock_new_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type NOT IN ('NEWITEM', 'UNKNOWN')
    )::bigint AS stock_used_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type = 'UNKNOWN'
    )::bigint AS stock_unknown_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition <> 'SELLABLE'
    )::bigint AS stock_unsellable,
    SUM(ending_warehouse_balance)::bigint AS stock_physical_total,
    COALESCE(
      to_jsonb(array_remove(array_agg(DISTINCT fulfillment_center), NULL)),
      '[]'::jsonb
    ) AS fulfillment_centers,
    jsonb_agg(
      jsonb_build_object(
        'fnsku', fnsku,
        'asin', asin,
        'conditionType', condition_type,
        'disposition', disposition,
        'stock', ending_warehouse_balance,
        'country', pais,
        'fulfillmentCenter', fulfillment_center,
        'rawLocation', raw_location,
        'mskuAliases', msku_aliases
      )
      ORDER BY disposition, condition_type, fnsku, asin, raw_location
    ) AS dispositions
  FROM canonical
  GROUP BY producto_id, pais, snapshot_date
)
SELECT
  producto_id,
  pais,
  snapshot_date,
  last_imported_at,
  COALESCE(stock_new_sellable, 0)::bigint AS stock_fba_sellable,
  COALESCE(stock_unsellable, 0)::bigint AS stock_fba_unsellable,
  COALESCE(stock_physical_total, 0)::bigint AS stock_fba_physical_total,
  COALESCE(stock_new_sellable, 0)::bigint AS stock_new_sellable,
  COALESCE(stock_used_sellable, 0)::bigint AS stock_used_sellable,
  COALESCE(stock_unknown_sellable, 0)::bigint AS stock_unknown_sellable,
  COALESCE(stock_unsellable, 0)::bigint AS stock_unsellable,
  dispositions,
  ((CURRENT_DATE - snapshot_date) > 3) AS is_stale,
  GREATEST((CURRENT_DATE - snapshot_date), 0)::integer AS stale_days,
  fulfillment_centers
FROM country_totals;

COMMENT ON VIEW public.v_latest_fba_inventory_by_product_country IS
  'Canonical physical FBA by product/country from Inventory Ledger. FC-like locations are preserved as provenance and grouped under UNKNOWN_LOCATION unless Amazon supplies a country.';

GRANT EXECUTE ON FUNCTION public.normalize_amazon_physical_country(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_amazon_fulfillment_center(text) TO anon, authenticated, service_role;
GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO anon, authenticated, service_role;

COMMIT;
