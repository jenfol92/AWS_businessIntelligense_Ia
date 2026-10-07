-- Test-only fixture from remote DDL read 2026-09-29. No credentials/network.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.productos(id uuid primary key);
CREATE TABLE public.amazon_spapi_report_jobs ("id" uuid DEFAULT gen_random_uuid() NOT NULL,
"report_type" text NOT NULL,
"report_id" text,
"report_document_id" text,
"status" text DEFAULT 'CREATED'::text NOT NULL,
"processing_status" text,
"marketplace_ids" text[],
"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
"completed_at" timestamp with time zone,
"downloaded_at" timestamp with time zone,
"source" text DEFAULT 'amazon_spapi'::text NOT NULL,
"error_message" text,
"raw" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL);
ALTER TABLE public.amazon_spapi_report_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_spapi_report_jobs ADD CONSTRAINT amazon_spapi_report_jobs_pkey PRIMARY KEY (id);
GRANT ALL ON public.amazon_spapi_report_jobs TO anon,authenticated,service_role;
CREATE TABLE public.amazon_fba_inventory_ledger_daily ("id" uuid DEFAULT gen_random_uuid() NOT NULL,
"producto_id" uuid,
"sku_original" text DEFAULT ''::text NOT NULL,
"sku_limpio" text NOT NULL,
"fnsku" text DEFAULT ''::text NOT NULL,
"asin" text DEFAULT ''::text NOT NULL,
"title" text,
"snapshot_date" date NOT NULL,
"disposition" text DEFAULT ''::text NOT NULL,
"starting_warehouse_balance" integer DEFAULT 0 NOT NULL,
"in_transit_between_warehouses" integer DEFAULT 0 NOT NULL,
"receipts" integer DEFAULT 0 NOT NULL,
"customer_shipments" integer DEFAULT 0 NOT NULL,
"customer_returns" integer DEFAULT 0 NOT NULL,
"vendor_returns" integer DEFAULT 0 NOT NULL,
"warehouse_transfer_in_out" integer DEFAULT 0 NOT NULL,
"found" integer DEFAULT 0 NOT NULL,
"lost" integer DEFAULT 0 NOT NULL,
"damaged" integer DEFAULT 0 NOT NULL,
"disposed" integer DEFAULT 0 NOT NULL,
"other_events" integer DEFAULT 0 NOT NULL,
"ending_warehouse_balance" integer DEFAULT 0 NOT NULL,
"unknown_events" integer DEFAULT 0 NOT NULL,
"location" text DEFAULT ''::text NOT NULL,
"location_country" text,
"source" text DEFAULT 'amazon_fba_ledger_summary_manual'::text NOT NULL,
"source_file_name" text,
"raw" jsonb,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
"msku_aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL,
"condition_type" text DEFAULT 'UNKNOWN'::text NOT NULL,
"report_document_id" text,
"manual_document_hash" text,
"document_identity_type" text NOT NULL,
"document_identity" text NOT NULL,
"location_raw" text NOT NULL,
"location_type" text NOT NULL,
"physical_country" text,
"location_evidence_source" text,
"location_evidence_confidence" text,
"duplicate_provenance" jsonb DEFAULT '[]'::jsonb NOT NULL);
ALTER TABLE public.amazon_fba_inventory_ledger_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_inventory_ledger_daily_pkey PRIMARY KEY (id);
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_inventory_ledger_daily_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE SET NULL;
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_inventory_ledger_daily_unique UNIQUE (document_identity, snapshot_date, asin, fnsku, location_raw, disposition, condition_type);
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_ledger_document_identity_type_check CHECK ((document_identity_type = ANY (ARRAY['REPORT_DOCUMENT_ID'::text, 'MANUAL_SHA256'::text, 'LEGACY_SOURCE_FILE'::text])));
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_ledger_location_confidence_check CHECK (((location_evidence_confidence IS NULL) OR (location_evidence_confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text]))));
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT amazon_fba_ledger_location_type_check CHECK ((location_type = ANY (ARRAY['COUNTRY'::text, 'FC'::text, 'OTHER'::text, 'UNKNOWN'::text])));
GRANT ALL ON public.amazon_fba_inventory_ledger_daily TO anon,authenticated,service_role;
CREATE VIEW public.v_product_fba_stock_daily AS  SELECT producto_id,
    sku_limpio,
    snapshot_date,
    sum(
        CASE
            WHEN (upper(TRIM(BOTH FROM disposition)) = 'SELLABLE'::text) THEN COALESCE(ending_warehouse_balance, 0)
            ELSE 0
        END) AS stock_sellable,
    sum(
        CASE
            WHEN (upper(TRIM(BOTH FROM disposition)) <> 'SELLABLE'::text) THEN COALESCE(ending_warehouse_balance, 0)
            ELSE 0
        END) AS stock_unsellable,
    sum(COALESCE(ending_warehouse_balance, 0)) AS stock_total,
    sum(COALESCE(receipts, 0)) AS receipts,
    sum(COALESCE(customer_shipments, 0)) AS customer_shipments,
    sum(COALESCE(customer_returns, 0)) AS customer_returns,
    sum(COALESCE(in_transit_between_warehouses, 0)) AS in_transit_between_warehouses,
    (count(DISTINCT NULLIF(TRIM(BOTH FROM location), ''::text)))::integer AS locations_count
   FROM amazon_fba_inventory_ledger_daily l
  GROUP BY producto_id, sku_limpio, snapshot_date;
CREATE TABLE paises(id uuid PRIMARY KEY,code text); CREATE TABLE amazon_marketplaces(id text,code text,pais_id uuid);
CREATE VIEW public.v_latest_fba_inventory_by_product_country AS  WITH latest_day AS (
         SELECT amazon_fba_inventory_ledger_daily.producto_id,
            max(amazon_fba_inventory_ledger_daily.snapshot_date) AS snapshot_date
           FROM amazon_fba_inventory_ledger_daily
          WHERE (amazon_fba_inventory_ledger_daily.producto_id IS NOT NULL)
          GROUP BY amazon_fba_inventory_ledger_daily.producto_id
        ), base AS (
         SELECT l.producto_id,
            COALESCE(NULLIF(TRIM(BOTH FROM l.location), ''::text), NULLIF(TRIM(BOTH FROM l.location_country), ''::text), 'UNKNOWN'::text) AS pais,
            l.snapshot_date,
            COALESCE(NULLIF(upper(TRIM(BOTH FROM l.disposition)), ''::text), 'UNKNOWN'::text) AS disposition,
            COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
            l.updated_at
           FROM (amazon_fba_inventory_ledger_daily l
             JOIN latest_day d ON (((d.producto_id = l.producto_id) AND (d.snapshot_date = l.snapshot_date))))
        ), disposition_totals AS (
         SELECT base.producto_id,
            base.pais,
            base.snapshot_date,
            base.disposition,
            max(base.updated_at) AS last_imported_at,
            sum(base.ending_warehouse_balance) AS stock
           FROM base
          GROUP BY base.producto_id, base.pais, base.snapshot_date, base.disposition
        )
 SELECT producto_id,
    pais,
    snapshot_date,
    max(last_imported_at) AS last_imported_at,
    (COALESCE(sum(stock) FILTER (WHERE (disposition = 'SELLABLE'::text)), (0)::numeric))::bigint AS stock_fba_sellable,
    (COALESCE(sum(stock) FILTER (WHERE (disposition <> 'SELLABLE'::text)), (0)::numeric))::bigint AS stock_fba_unsellable,
    (COALESCE(sum(stock), (0)::numeric))::bigint AS stock_fba_physical_total,
    jsonb_agg(jsonb_build_object('disposition', disposition, 'stock', stock) ORDER BY
        CASE
            WHEN (disposition = 'SELLABLE'::text) THEN 0
            ELSE 1
        END, stock DESC, disposition) AS dispositions,
    ((CURRENT_DATE - snapshot_date) > 3) AS is_stale,
    GREATEST((CURRENT_DATE - snapshot_date), 0) AS stale_days
   FROM disposition_totals
  GROUP BY producto_id, pais, snapshot_date;
CREATE VIEW public.v_latest_fba_inventory_by_product_location AS  WITH latest_snapshot AS (
         SELECT amazon_fba_inventory_ledger_daily.producto_id,
            max(amazon_fba_inventory_ledger_daily.snapshot_date) AS snapshot_date
           FROM amazon_fba_inventory_ledger_daily
          WHERE (amazon_fba_inventory_ledger_daily.producto_id IS NOT NULL)
          GROUP BY amazon_fba_inventory_ledger_daily.producto_id
        ), chosen_document AS (
         SELECT DISTINCT ON (l.producto_id, l.snapshot_date) l.producto_id,
            l.snapshot_date,
            l.document_identity
           FROM (amazon_fba_inventory_ledger_daily l
             JOIN latest_snapshot s USING (producto_id, snapshot_date))
          ORDER BY l.producto_id, l.snapshot_date, l.updated_at DESC, l.document_identity
        ), canonical AS (
         SELECT l.id,
            l.producto_id,
            l.sku_original,
            l.sku_limpio,
            l.fnsku,
            l.asin,
            l.title,
            l.snapshot_date,
            l.disposition,
            l.starting_warehouse_balance,
            l.in_transit_between_warehouses,
            l.receipts,
            l.customer_shipments,
            l.customer_returns,
            l.vendor_returns,
            l.warehouse_transfer_in_out,
            l.found,
            l.lost,
            l.damaged,
            l.disposed,
            l.other_events,
            l.ending_warehouse_balance,
            l.unknown_events,
            l.location,
            l.location_country,
            l.source,
            l.source_file_name,
            l.raw,
            l.created_at,
            l.updated_at,
            l.msku_aliases,
            l.condition_type,
            l.report_document_id,
            l.manual_document_hash,
            l.document_identity_type,
            l.document_identity,
            l.location_raw,
            l.location_type,
            l.physical_country,
            l.location_evidence_source,
            l.location_evidence_confidence,
            l.duplicate_provenance
           FROM (amazon_fba_inventory_ledger_daily l
             JOIN chosen_document d USING (producto_id, snapshot_date, document_identity))
        )
 SELECT c.producto_id,
    c.asin,
    c.fnsku,
    c.snapshot_date,
    c.location_raw,
    c.location_type,
    c.physical_country,
    am.code AS marketplace_reference,
    COALESCE(sum(c.ending_warehouse_balance) FILTER (WHERE (upper(c.disposition) = 'SELLABLE'::text)), (0)::bigint) AS sellable,
    COALESCE(sum(c.ending_warehouse_balance) FILTER (WHERE ((upper(c.disposition) = 'SELLABLE'::text) AND (upper(c.condition_type) = ANY (ARRAY['NEW'::text, 'NEWITEM'::text])))), (0)::bigint) AS new_sellable,
    COALESCE(sum(c.ending_warehouse_balance) FILTER (WHERE ((upper(c.disposition) = 'SELLABLE'::text) AND (upper(c.condition_type) <> ALL (ARRAY['NEW'::text, 'NEWITEM'::text, 'UNKNOWN'::text])))), (0)::bigint) AS used_sellable,
    COALESCE(sum(c.ending_warehouse_balance) FILTER (WHERE ((upper(c.disposition) = 'SELLABLE'::text) AND (upper(c.condition_type) = 'UNKNOWN'::text))), (0)::bigint) AS unknown_condition_sellable,
    COALESCE(sum(c.ending_warehouse_balance) FILTER (WHERE (upper(c.disposition) <> 'SELLABLE'::text)), (0)::bigint) AS unsellable,
    sum(c.ending_warehouse_balance) AS physical_total,
    ARRAY( SELECT DISTINCT alias.alias
           FROM (canonical alias_row
             CROSS JOIN LATERAL unnest(alias_row.msku_aliases) alias(alias))
          WHERE ((alias_row.producto_id = c.producto_id) AND (alias_row.snapshot_date = c.snapshot_date) AND (alias_row.document_identity = c.document_identity) AND (alias_row.asin = c.asin) AND (alias_row.fnsku = c.fnsku) AND (alias_row.location_raw = c.location_raw) AND (alias.alias <> ''::text))
          ORDER BY alias.alias) AS seller_sku_aliases,
    c.document_identity_type,
    c.document_identity,
    c.report_document_id,
    c.manual_document_hash,
    c.source,
    c.source_file_name,
    max(c.updated_at) AS last_imported_at,
    ((CURRENT_DATE - c.snapshot_date) > 3) AS is_stale,
    GREATEST((CURRENT_DATE - c.snapshot_date), 0) AS stale_days
   FROM ((canonical c
     LEFT JOIN paises p ON ((p.code = c.physical_country)))
     LEFT JOIN LATERAL ( SELECT candidate.code
           FROM amazon_marketplaces candidate
          WHERE (candidate.pais_id = p.id)
          ORDER BY candidate.code
         LIMIT 1) am ON (true))
  GROUP BY c.producto_id, c.asin, c.fnsku, c.snapshot_date, c.location_raw, c.location_type, c.physical_country, am.code, c.document_identity_type, c.document_identity, c.report_document_id, c.manual_document_hash, c.source, c.source_file_name;
CREATE FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
