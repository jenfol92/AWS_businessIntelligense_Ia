-- Consolidated Inventory Ledger contract repair.
-- Baseline: deployed original table + 20260714 legacy view.
-- Does not depend on 20260715 or 20260814_01 and does not replace the legacy view.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- PHASE: ADD_COLUMNS
ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ADD COLUMN IF NOT EXISTS msku_aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS condition_type text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS report_document_id text NULL,
  ADD COLUMN IF NOT EXISTS manual_document_hash text NULL,
  ADD COLUMN IF NOT EXISTS document_identity_type text NULL,
  ADD COLUMN IF NOT EXISTS document_identity text NULL,
  ADD COLUMN IF NOT EXISTS location_raw text NULL,
  ADD COLUMN IF NOT EXISTS location_type text NULL,
  ADD COLUMN IF NOT EXISTS physical_country text NULL,
  ADD COLUMN IF NOT EXISTS location_evidence_source text NULL,
  ADD COLUMN IF NOT EXISTS location_evidence_confidence text NULL,
  ADD COLUMN IF NOT EXISTS duplicate_provenance jsonb NOT NULL DEFAULT '[]'::jsonb;

-- PHASE: COMBINED_BACKFILL
-- One physical rewrite performs document, condition, alias and location backfill.
-- Historical files cannot acquire a content hash retroactively and therefore use
-- the explicitly weak LEGACY_SOURCE_FILE identity.
WITH known_countries AS (
  SELECT upper(trim(code)) code
  FROM public.paises
  WHERE COALESCE(activo, true) = true
), inbound_evidence AS (
  SELECT
    upper(trim(destination_center)) AS center,
    CASE WHEN COUNT(DISTINCT upper(trim(destination_country))) FILTER (
      WHERE NULLIF(trim(destination_country), '') IS NOT NULL
    ) = 1 THEN MAX(upper(trim(destination_country))) FILTER (
      WHERE NULLIF(trim(destination_country), '') IS NOT NULL
    ) ELSE NULL END AS country
  FROM public.amazon_inbound_shipments
  WHERE NULLIF(trim(destination_center), '') IS NOT NULL
  GROUP BY upper(trim(destination_center))
), classified AS (
  SELECT l.id, trim(l.location) location_raw_value,
    pc.code recognized_country, ie.center, ie.country
  FROM public.amazon_fba_inventory_ledger_daily l
  LEFT JOIN known_countries pc ON pc.code = upper(trim(l.location))
  LEFT JOIN inbound_evidence ie ON ie.center = upper(trim(l.location))
)
UPDATE public.amazon_fba_inventory_ledger_daily l
SET
  msku_aliases = CASE
    WHEN cardinality(l.msku_aliases) = 0 AND NULLIF(trim(l.sku_original), '') IS NOT NULL
      THEN ARRAY[trim(l.sku_original)]
    ELSE l.msku_aliases
  END,
  condition_type = COALESCE(NULLIF(upper(trim(l.condition_type)), ''), 'UNKNOWN'),
  report_document_id = NULLIF(trim(l.report_document_id), ''),
  location_raw = classified.location_raw_value,
  document_identity_type = COALESCE(
    l.document_identity_type,
    CASE WHEN NULLIF(trim(l.report_document_id), '') IS NOT NULL
      THEN 'REPORT_DOCUMENT_ID' ELSE 'LEGACY_SOURCE_FILE' END
  ),
  document_identity = COALESCE(
    NULLIF(trim(l.document_identity), ''),
    CASE WHEN NULLIF(trim(l.report_document_id), '') IS NOT NULL
      THEN 'report:' || trim(l.report_document_id)
      ELSE 'legacy:' || md5(COALESCE(l.source, '') || chr(31) || COALESCE(l.source_file_name, ''))
    END
  ),
  location_type = CASE
    WHEN NULLIF(classified.location_raw_value, '') IS NULL THEN 'UNKNOWN'
    WHEN classified.recognized_country IS NOT NULL THEN 'COUNTRY'
    WHEN classified.center IS NOT NULL THEN 'FC'
    ELSE 'OTHER'
  END,
  physical_country = CASE
    WHEN classified.recognized_country IS NOT NULL THEN classified.recognized_country
    ELSE classified.country
  END,
  location_evidence_source = CASE
    WHEN classified.recognized_country IS NOT NULL
      THEN 'LEDGER_ISO_COUNTRY'
    WHEN classified.center IS NOT NULL THEN 'INBOUND_DESTINATION'
    ELSE NULL
  END,
  location_evidence_confidence = CASE
    WHEN classified.recognized_country IS NOT NULL THEN 'HIGH'
    WHEN classified.center IS NOT NULL THEN 'MEDIUM'
    ELSE NULL
  END
FROM classified
WHERE classified.id = l.id;

-- PHASE: IDENTITY_CHECK
DO $$
DECLARE conflicts integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.amazon_fba_inventory_ledger_daily WHERE NULLIF(trim(fnsku), '') IS NULL)
     OR EXISTS (SELECT 1 FROM public.amazon_fba_inventory_ledger_daily WHERE NULLIF(trim(asin), '') IS NULL)
     OR EXISTS (SELECT 1 FROM public.amazon_fba_inventory_ledger_daily WHERE NULLIF(trim(location_raw), '') IS NULL)
     OR EXISTS (SELECT 1 FROM public.amazon_fba_inventory_ledger_daily WHERE NULLIF(trim(document_identity), '') IS NULL) THEN
    RAISE EXCEPTION 'LEDGER_DOCUMENT_CONFLICT: required grain identity is missing';
  END IF;

END $$;

-- PHASE: DUPLICATE_SCAN
-- Materialize only duplicate grains. With zero duplicates the expensive merge
-- and delete statements are not even planned or executed.
CREATE TEMP TABLE ledger_duplicate_groups ON COMMIT DROP AS
  SELECT document_identity, snapshot_date, asin, fnsku, location_raw,
    disposition, condition_type, COUNT(*) row_count
  FROM public.amazon_fba_inventory_ledger_daily
  GROUP BY document_identity, snapshot_date, asin, fnsku, location_raw,
    disposition, condition_type
  HAVING COUNT(*) > 1;

-- PHASE: DEDUP
DO $$
DECLARE conflicts integer;
BEGIN
  SELECT COUNT(*) INTO conflicts
  FROM ledger_duplicate_groups g
  JOIN public.amazon_fba_inventory_ledger_daily l USING (
    document_identity, snapshot_date, asin, fnsku, location_raw, disposition, condition_type
  )
  GROUP BY g.document_identity, g.snapshot_date, g.asin, g.fnsku,
    g.location_raw, g.disposition, g.condition_type
  HAVING COUNT(DISTINCT jsonb_build_array(
    l.producto_id, l.starting_warehouse_balance, l.ending_warehouse_balance,
    l.in_transit_between_warehouses, l.receipts, l.customer_shipments,
    l.customer_returns, l.vendor_returns, l.warehouse_transfer_in_out,
    l.found, l.lost, l.damaged, l.disposed, l.other_events, l.unknown_events,
    NULLIF(trim(l.sku_limpio), '')
  )) > 1
  LIMIT 1;
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'LEDGER_IDENTITY_CONFLICT: duplicate quantitative grain conflicts';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger_duplicate_groups) THEN
    EXECUTE $dedup$
      WITH ranked AS (
        SELECT l.id, first_value(l.id) OVER (
          PARTITION BY l.document_identity, l.snapshot_date, l.asin, l.fnsku,
            l.location_raw, l.disposition, l.condition_type
          ORDER BY l.created_at, l.id
        ) keep_id
        FROM public.amazon_fba_inventory_ledger_daily l
        JOIN ledger_duplicate_groups g USING (
          document_identity, snapshot_date, asin, fnsku, location_raw, disposition, condition_type
        )
      ), merged AS (
        SELECT r.keep_id,
          array_agg(DISTINCT alias ORDER BY alias) FILTER (WHERE alias <> '') aliases,
          jsonb_agg(jsonb_build_object(
            'id', l.id, 'skuOriginal', l.sku_original, 'source', l.source,
            'sourceFileName', l.source_file_name, 'raw', l.raw
          ) ORDER BY l.created_at, l.id) FILTER (WHERE l.id <> r.keep_id) provenance
        FROM ranked r
        JOIN public.amazon_fba_inventory_ledger_daily l ON l.id = r.id
        LEFT JOIN LATERAL unnest(CASE WHEN cardinality(l.msku_aliases) > 0
          THEN l.msku_aliases ELSE ARRAY[l.sku_original] END) alias ON true
        GROUP BY r.keep_id
      )
      UPDATE public.amazon_fba_inventory_ledger_daily l
      SET msku_aliases = COALESCE(m.aliases, l.msku_aliases),
          duplicate_provenance = COALESCE(m.provenance, '[]'::jsonb)
      FROM merged m WHERE l.id = m.keep_id;

      WITH ranked AS (
        SELECT l.id, row_number() OVER (
          PARTITION BY l.document_identity, l.snapshot_date, l.asin, l.fnsku,
            l.location_raw, l.disposition, l.condition_type
          ORDER BY l.created_at, l.id
        ) rn
        FROM public.amazon_fba_inventory_ledger_daily l
        JOIN ledger_duplicate_groups g USING (
          document_identity, snapshot_date, asin, fnsku, location_raw, disposition, condition_type
        )
      )
      DELETE FROM public.amazon_fba_inventory_ledger_daily l
      USING ranked r WHERE l.id = r.id AND r.rn > 1
    $dedup$;
  END IF;
END $$;

-- PHASE: CONSTRAINTS
ALTER TABLE public.amazon_fba_inventory_ledger_daily
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_ledger_daily_unique;
ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ALTER COLUMN document_identity_type SET NOT NULL,
  ALTER COLUMN document_identity SET NOT NULL,
  ALTER COLUMN location_raw SET NOT NULL,
  ALTER COLUMN location_type SET NOT NULL,
  ADD CONSTRAINT amazon_fba_ledger_document_identity_type_check
    CHECK (document_identity_type IN ('REPORT_DOCUMENT_ID','MANUAL_SHA256','LEGACY_SOURCE_FILE')),
  ADD CONSTRAINT amazon_fba_ledger_location_type_check
    CHECK (location_type IN ('COUNTRY','FC','OTHER','UNKNOWN')),
  ADD CONSTRAINT amazon_fba_ledger_location_confidence_check
    CHECK (location_evidence_confidence IS NULL OR location_evidence_confidence IN ('HIGH','MEDIUM','LOW')),
  ADD CONSTRAINT amazon_fba_inventory_ledger_daily_unique UNIQUE (
    document_identity, snapshot_date, asin, fnsku, location_raw, disposition, condition_type
  );

-- PHASE: INDEXES
CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_location_raw
  ON public.amazon_fba_inventory_ledger_daily(location_raw, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_physical_country
  ON public.amazon_fba_inventory_ledger_daily(physical_country, snapshot_date DESC)
  WHERE physical_country IS NOT NULL;

-- PHASE: VIEW
CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_location AS
WITH latest_snapshot AS (
  SELECT producto_id, MAX(snapshot_date) snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id IS NOT NULL GROUP BY producto_id
), chosen_document AS (
  SELECT DISTINCT ON (l.producto_id, l.snapshot_date)
    l.producto_id, l.snapshot_date, l.document_identity
  FROM public.amazon_fba_inventory_ledger_daily l
  JOIN latest_snapshot s USING (producto_id, snapshot_date)
  ORDER BY l.producto_id, l.snapshot_date, l.updated_at DESC, l.document_identity
), canonical AS (
  SELECT l.*
  FROM public.amazon_fba_inventory_ledger_daily l
  JOIN chosen_document d USING (producto_id, snapshot_date, document_identity)
)
SELECT
  c.producto_id, c.asin, c.fnsku, c.snapshot_date,
  c.location_raw, c.location_type, c.physical_country,
  am.code AS marketplace_reference,
  COALESCE(SUM(c.ending_warehouse_balance) FILTER (WHERE upper(c.disposition) = 'SELLABLE'), 0)::bigint AS sellable,
  COALESCE(SUM(c.ending_warehouse_balance) FILTER (WHERE upper(c.disposition) = 'SELLABLE' AND upper(c.condition_type) IN ('NEW','NEWITEM')), 0)::bigint AS new_sellable,
  COALESCE(SUM(c.ending_warehouse_balance) FILTER (WHERE upper(c.disposition) = 'SELLABLE' AND upper(c.condition_type) NOT IN ('NEW','NEWITEM','UNKNOWN')), 0)::bigint AS used_sellable,
  COALESCE(SUM(c.ending_warehouse_balance) FILTER (WHERE upper(c.disposition) = 'SELLABLE' AND upper(c.condition_type) = 'UNKNOWN'), 0)::bigint AS unknown_condition_sellable,
  COALESCE(SUM(c.ending_warehouse_balance) FILTER (WHERE upper(c.disposition) <> 'SELLABLE'), 0)::bigint AS unsellable,
  SUM(c.ending_warehouse_balance)::bigint AS physical_total,
  ARRAY(
    SELECT DISTINCT alias
    FROM canonical alias_row
    CROSS JOIN LATERAL unnest(alias_row.msku_aliases) alias
    WHERE alias_row.producto_id = c.producto_id
      AND alias_row.snapshot_date = c.snapshot_date
      AND alias_row.document_identity = c.document_identity
      AND alias_row.asin = c.asin
      AND alias_row.fnsku = c.fnsku
      AND alias_row.location_raw = c.location_raw
      AND alias <> ''
    ORDER BY alias
  ) AS seller_sku_aliases,
  c.document_identity_type, c.document_identity, c.report_document_id,
  c.manual_document_hash, c.source, c.source_file_name,
  MAX(c.updated_at) AS last_imported_at,
  ((CURRENT_DATE - c.snapshot_date) > 3) AS is_stale,
  GREATEST(CURRENT_DATE - c.snapshot_date, 0)::integer AS stale_days
FROM canonical c
LEFT JOIN public.paises p ON p.code = c.physical_country
LEFT JOIN LATERAL (
  SELECT candidate.code
  FROM public.amazon_marketplaces candidate
  WHERE candidate.pais_id = p.id
  ORDER BY candidate.code
  LIMIT 1
) am ON true
GROUP BY c.producto_id, c.asin, c.fnsku, c.snapshot_date, c.location_raw,
  c.location_type, c.physical_country, am.code, c.document_identity_type,
  c.document_identity, c.report_document_id, c.manual_document_hash,
  c.source, c.source_file_name;

COMMENT ON VIEW public.v_latest_fba_inventory_by_product_location IS
  'Physical Amazon location evidence only. Never use as EU/UK operational availability.';
GRANT SELECT ON public.v_latest_fba_inventory_by_product_location TO anon, authenticated, service_role;
COMMIT;
