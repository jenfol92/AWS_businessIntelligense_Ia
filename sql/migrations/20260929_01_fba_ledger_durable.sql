-- REVIEW ONLY. Never executed by the application. No legacy rows are certified.
BEGIN;
ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD COLUMN IF NOT EXISTS publication_job_id uuid;
-- A pre-existing column does not imply that its FK exists. Repair only the expected contract.
DO $$
DECLARE col smallint; target_col smallint; fk_name text;
BEGIN
 SELECT attnum INTO col FROM pg_attribute WHERE attrelid='public.amazon_fba_inventory_ledger_daily'::regclass
  AND attname='publication_job_id' AND atttypid='uuid'::regtype AND NOT attisdropped;
 IF col IS NULL THEN RAISE EXCEPTION 'LEDGER_PUBLICATION_COLUMN_TYPE_MISMATCH'; END IF;
 SELECT attnum INTO target_col FROM pg_attribute WHERE attrelid='public.amazon_spapi_report_jobs'::regclass AND attname='id';
 SELECT conname INTO fk_name FROM pg_constraint WHERE conrelid='public.amazon_fba_inventory_ledger_daily'::regclass
  AND contype='f' AND conkey=ARRAY[col] AND confrelid='public.amazon_spapi_report_jobs'::regclass
  AND confkey=ARRAY[target_col] AND confdeltype='a' AND confupdtype='a' LIMIT 1;
 IF fk_name IS NULL THEN
  IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.amazon_fba_inventory_ledger_daily'::regclass
    AND contype='f' AND col=ANY(conkey)) THEN RAISE EXCEPTION 'LEDGER_PUBLICATION_FK_MISMATCH'; END IF;
  ALTER TABLE public.amazon_fba_inventory_ledger_daily ADD CONSTRAINT fba_ledger_publication_job_fk
    FOREIGN KEY(publication_job_id) REFERENCES public.amazon_spapi_report_jobs(id);
 ELSE
  EXECUTE format('ALTER TABLE public.amazon_fba_inventory_ledger_daily VALIDATE CONSTRAINT %I',fk_name);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS fba_ledger_publication_job_idx ON public.amazon_fba_inventory_ledger_daily(publication_job_id)
  WHERE publication_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fba_ledger_published_document_idx
  ON public.amazon_spapi_report_jobs ((raw->'ledger'->'receipt'->>'documentId'))
  WHERE source='fba_ledger_coordinator_v1' AND raw->'ledger'->'receipt'->>'documentId' IS NOT NULL;
CREATE INDEX IF NOT EXISTS fba_ledger_due_idx ON public.amazon_spapi_report_jobs(requested_at)
  WHERE source='fba_ledger_coordinator_v1' AND status IN ('PENDING','PROCESSING','RATE_LIMITED');

CREATE OR REPLACE FUNCTION public.commit_fba_ledger_publication(
 p_job_id uuid,p_revision integer,p_lease_token text,p_rows_text text,p_manifest jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='30s' AS $$
DECLARE j public.amazon_spapi_report_jobs%ROWTYPE; s jsonb; rows_json jsonb; receipt jsonb;
 n integer; linked integer; unknown_locations integer; unknown_conditions integer; published timestamptz:=clock_timestamp();
 r jsonb; quantity text; columns_sql text;
BEGIN
 SELECT * INTO j FROM public.amazon_spapi_report_jobs WHERE id=p_job_id FOR UPDATE;
 s:=j.raw->'ledger';
 IF j.id IS NULL OR j.source<>'fba_ledger_coordinator_v1' OR j.report_type<>'GET_LEDGER_SUMMARY_VIEW_DATA'
   OR s->>'owner' IS DISTINCT FROM 'fba_ledger_coordinator_v1' OR s->>'version' IS DISTINCT FROM '1'
   THEN RAISE EXCEPTION 'LEDGER_INVALID_OWNER'; END IF;
 IF octet_length(p_rows_text)>33554432 OR p_rows_text IS NULL OR
    p_manifest->>'digest' IS DISTINCT FROM encode(sha256(convert_to(p_rows_text,'UTF8')),'hex')
    THEN RAISE EXCEPTION 'LEDGER_INVALID_DIGEST'; END IF;
 IF s->'receipt'->>'documentId' IS NOT NULL THEN
   IF s->'receipt'->>'digest' IS DISTINCT FROM p_manifest->>'digest'
      OR s->'receipt'->>'documentId' IS DISTINCT FROM p_manifest->>'documentId'
      OR s->>'status'<>'COMPLETED' THEN RAISE EXCEPTION 'LEDGER_REPLAY_MISMATCH'; END IF;
   RETURN s->'receipt';
 END IF;
 IF (s->>'revision')::integer IS DISTINCT FROM p_revision OR s->'lease'->>'token' IS DISTINCT FROM p_lease_token
   OR p_lease_token IS NULL OR COALESCE((s->'lease'->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   OR s->>'phase' IS DISTINCT FROM 'PUBLISH' OR COALESCE(s->>'status','') NOT IN ('PROCESSING','PENDING','RATE_LIMITED')
   THEN RAISE EXCEPTION 'LEDGER_FENCE_REJECTED'; END IF;
 IF s->'manifest' IS DISTINCT FROM p_manifest OR p_manifest->>'version' IS DISTINCT FROM '1'
   OR s->>'documentId' IS DISTINCT FROM p_manifest->>'documentId' OR j.report_document_id IS DISTINCT FROM p_manifest->>'documentId'
   OR s->>'reportId' IS DISTINCT FROM p_manifest->>'reportId' OR j.report_id IS DISTINCT FROM p_manifest->>'reportId'
   OR p_manifest->>'reportType' IS DISTINCT FROM j.report_type
   OR p_manifest->>'fromDate' IS DISTINCT FROM s->>'date' OR p_manifest->>'toDate' IS DISTINCT FROM s->>'date'
   OR p_manifest->'marketplaceIds' IS DISTINCT FROM s->'marketplaceIds' OR to_jsonb(j.marketplace_ids) IS DISTINCT FROM s->'marketplaceIds'
   OR s->>'scope' IS DISTINCT FROM 'EU:COUNTRY:DAILY:'||(s->>'date')||':'||array_to_string(j.marketplace_ids,',')
   OR p_manifest->>'aggregateByLocation' IS DISTINCT FROM 'COUNTRY' OR p_manifest->>'aggregatedByTimePeriod' IS DISTINCT FROM 'DAILY'
   OR p_manifest->'errors' IS DISTINCT FROM '[]'::jsonb OR jsonb_typeof(p_manifest->'warnings') IS DISTINCT FROM 'array'
   OR COALESCE(p_manifest->>'documentDigest','') !~ '^[0-9a-f]{64}$' OR p_manifest->>'publishedAt' IS NOT NULL
   OR COALESCE(s->>'reportId','')='' OR COALESCE(s->>'documentId','')=''
   OR COALESCE(s->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR COALESCE(s->>'reportCreatedAt','')='' OR cardinality(j.marketplace_ids) IS NULL OR cardinality(j.marketplace_ids)=0
   THEN RAISE EXCEPTION 'LEDGER_INVALID_MANIFEST'; END IF;
 rows_json:=p_rows_text::jsonb;
 IF jsonb_typeof(rows_json)<>'array' OR jsonb_array_length(rows_json) NOT BETWEEN 1 AND 25000 THEN RAISE EXCEPTION 'LEDGER_INVALID_ROWS'; END IF;
 n:=jsonb_array_length(rows_json); linked:=0; unknown_locations:=0; unknown_conditions:=0;
 FOR r IN SELECT value FROM jsonb_array_elements(rows_json) LOOP
   IF r->>'snapshot_date' IS DISTINCT FROM s->>'date' OR r->>'document_identity' IS DISTINCT FROM 'report:'||(s->>'documentId')
      OR r->>'report_document_id' IS DISTINCT FROM s->>'documentId' OR r->>'document_identity_type' IS DISTINCT FROM 'REPORT_DOCUMENT_ID'
      OR r->>'source' IS DISTINCT FROM 'fba_ledger_coordinator_v1'
      OR COALESCE(r->>'asin','')='' OR COALESCE(r->>'fnsku','')='' OR COALESCE(r->>'location_raw','')=''
      OR COALESCE(r->>'condition_type','')='' OR COALESCE(r->>'disposition','')='' OR COALESCE(r->>'sku_original','')=''
      OR r->>'id' IS NOT NULL OR r->>'publication_job_id' IS NOT NULL
      THEN RAISE EXCEPTION 'LEDGER_INVALID_ROW_IDENTITY'; END IF;
   FOREACH quantity IN ARRAY ARRAY['starting_warehouse_balance','ending_warehouse_balance','in_transit_between_warehouses',
     'receipts','customer_shipments','customer_returns','vendor_returns','warehouse_transfer_in_out','found','lost','damaged','disposed','other_events','unknown_events'] LOOP
     IF jsonb_typeof(r->quantity) IS DISTINCT FROM 'number' OR r->>quantity !~ '^-?[0-9]+$'
       OR (r->>quantity)::numeric NOT BETWEEN -2147483648 AND 2147483647 THEN RAISE EXCEPTION 'LEDGER_INVALID_QUANTITY'; END IF;
   END LOOP;
   IF r->>'producto_id' IS NOT NULL THEN linked:=linked+1; END IF;
   IF r->>'physical_country' IS NULL THEN unknown_locations:=unknown_locations+1; END IF;
   IF r->>'condition_type'='UNKNOWN' THEN unknown_conditions:=unknown_conditions+1; END IF;
 END LOOP;
 IF (p_manifest->>'canonicalRows')::integer IS DISTINCT FROM n
   OR (p_manifest->>'linkedRows')::integer IS DISTINCT FROM linked
   OR (p_manifest->>'unlinkedRows')::integer IS DISTINCT FROM n-linked
   OR (p_manifest->>'unclassifiedLocations')::integer IS DISTINCT FROM unknown_locations
   OR (p_manifest->>'unknownConditionRows')::integer IS DISTINCT FROM unknown_conditions
   OR (p_manifest->>'parsedRows')::integer IS DISTINCT FROM n+(p_manifest->>'duplicateRows')::integer
   OR COALESCE((p_manifest->>'duplicateRows')::integer,-1)<0
   OR (p_manifest->>'coverageValid')::boolean IS DISTINCT FROM (linked=n AND unknown_locations=0)
   THEN RAISE EXCEPTION 'LEDGER_INVALID_COVERAGE'; END IF;
 -- Row uniqueness and FK/constraints are checked by PostgreSQL; any failure rolls everything back.
 -- Explicit columns preserve defaults (id/created_at); never accept caller-supplied primary keys.
 SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns_sql FROM pg_attribute
 WHERE attrelid='public.amazon_fba_inventory_ledger_daily'::regclass AND attnum>0 AND NOT attisdropped
 AND attname NOT IN ('id','created_at','publication_job_id');
 EXECUTE format('INSERT INTO public.amazon_fba_inventory_ledger_daily (%s,publication_job_id) SELECT %s,$2 FROM jsonb_populate_recordset(NULL::public.amazon_fba_inventory_ledger_daily,$1)',columns_sql,columns_sql)
 USING rows_json,p_job_id;
 IF (s->'lease'->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'LEDGER_FENCE_EXPIRED_DURING_PUBLICATION'; END IF;
 receipt:=jsonb_build_object('jobId',p_job_id,'documentId',s->>'documentId','digest',p_manifest->>'digest','rows',n,'publishedAt',published);
 s:=s||jsonb_build_object('status','COMPLETED','revision',p_revision+1,'lease',NULL,'nextAttemptAt',NULL,'error',NULL,
   'receipt',receipt,'manifest',p_manifest||jsonb_build_object('publishedAt',published));
 UPDATE public.amazon_spapi_report_jobs SET raw=jsonb_set(raw,'{ledger}',s),status='COMPLETED',completed_at=published,updated_at=published WHERE id=p_job_id;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.commit_fba_ledger_publication(uuid,integer,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_fba_ledger_publication(uuid,integer,text,text,jsonb) TO service_role;

-- Published evidence is immutable, including against legacy upserts.
CREATE OR REPLACE FUNCTION public.guard_published_fba_ledger() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.publication_job_id IS NOT NULL THEN RAISE EXCEPTION 'LEDGER_PUBLISHED_IMMUTABLE'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS guard_published_fba_ledger ON public.amazon_fba_inventory_ledger_daily;
CREATE TRIGGER guard_published_fba_ledger BEFORE UPDATE OR DELETE ON public.amazon_fba_inventory_ledger_daily
 FOR EACH ROW EXECUTE FUNCTION public.guard_published_fba_ledger();

-- One complete document per UTC day. Never add reports of the same physical network.
CREATE OR REPLACE VIEW public.v_published_fba_ledger_daily AS
 WITH docs AS (
  SELECT id,raw->'ledger' AS s,row_number() OVER (PARTITION BY raw->'ledger'->>'date'
   ORDER BY (raw->'ledger'->>'reportCreatedAt')::timestamptz DESC,completed_at DESC,id DESC) AS rn
  FROM public.amazon_spapi_report_jobs WHERE source='fba_ledger_coordinator_v1'
   AND report_type='GET_LEDGER_SUMMARY_VIEW_DATA' AND status='COMPLETED'
   AND raw->'ledger'->>'status'='COMPLETED' AND raw->'ledger'->'receipt'->>'documentId' IS NOT NULL
 ) SELECT l.* FROM public.amazon_fba_inventory_ledger_daily l JOIN docs d ON l.publication_job_id=d.id
 WHERE d.rn=1 AND l.document_identity='report:'||(d.s->>'documentId');
REVOKE ALL ON public.v_published_fba_ledger_daily FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_published_fba_ledger_daily TO service_role;

-- Publication is not completeness. Filter AFTER choosing the latest document per day:
-- a newer incomplete document must never fall back to an older complete one that day.
CREATE OR REPLACE VIEW public.v_complete_fba_ledger_daily AS
 SELECT l.* FROM public.v_published_fba_ledger_daily l
 JOIN public.amazon_spapi_report_jobs j ON j.id=l.publication_job_id
 WHERE j.raw->'ledger'->'manifest'->'coverageValid'='true'::jsonb;
REVOKE ALL ON public.v_complete_fba_ledger_daily FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_complete_fba_ledger_daily TO service_role;

CREATE OR REPLACE FUNCTION public.read_published_fba_ledger(product_ids uuid[])
 RETURNS TABLE(id uuid,producto_id uuid,sku_original text,fnsku text,asin text,snapshot_date date,disposition text,condition_type text,
 ending_warehouse_balance integer,in_transit_between_warehouses integer,location text,physical_country text,updated_at timestamptz,coverage_valid boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT l.id,l.producto_id,l.sku_original,l.fnsku,l.asin,l.snapshot_date,l.disposition,l.condition_type,
 l.ending_warehouse_balance,l.in_transit_between_warehouses,l.location_raw,l.physical_country,j.completed_at,
 (j.raw->'ledger'->'manifest'->>'coverageValid')::boolean
 FROM public.v_published_fba_ledger_daily l JOIN public.amazon_spapi_report_jobs j ON j.id=l.publication_job_id
 WHERE l.producto_id=ANY(product_ids) AND cardinality(product_ids)<=100
 AND l.snapshot_date=(SELECT max(snapshot_date) FROM public.v_published_fba_ledger_daily)
 ORDER BY l.id;
$$;
REVOKE ALL ON FUNCTION public.read_published_fba_ledger(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_published_fba_ledger(uuid[]) TO authenticated,service_role;
REVOKE ALL ON public.amazon_fba_inventory_ledger_daily FROM PUBLIC,anon,authenticated;
-- Jobs retain existing RLS/grants: do not change other job owners.
REVOKE ALL ON public.v_product_fba_stock_daily,public.v_latest_fba_inventory_by_product_country,
 public.v_latest_fba_inventory_by_product_location FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.v_product_fba_stock_daily TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) FROM PUBLIC,anon,authenticated;
-- VIEW_DEFINITIONS are appended below from reviewed remote DDL, replacing only the input relation.

CREATE OR REPLACE VIEW public.v_product_fba_stock_daily AS
 SELECT producto_id,
    sku_limpio,
    snapshot_date,
    sum(
        CASE
            WHEN (upper(TRIM(BOTH FROM disposition)) = 'SELLABLE'::text AND upper(condition_type) IN ('NEW','NEWITEM') AND sku_original NOT LIKE 'amzn.gr.%') THEN COALESCE(ending_warehouse_balance, 0)
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
   FROM v_complete_fba_ledger_daily l
  GROUP BY producto_id, sku_limpio, snapshot_date;

CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_country AS
 WITH latest_day AS (
         SELECT v_complete_fba_ledger_daily.producto_id,
            max(v_complete_fba_ledger_daily.snapshot_date) AS snapshot_date
           FROM v_complete_fba_ledger_daily
          WHERE (v_complete_fba_ledger_daily.producto_id IS NOT NULL) AND snapshot_date=(SELECT max(snapshot_date) FROM public.v_published_fba_ledger_daily)
          GROUP BY v_complete_fba_ledger_daily.producto_id
        ), base AS (
         SELECT l.producto_id,
            COALESCE(NULLIF(TRIM(BOTH FROM l.physical_country), ''::text), 'UNKNOWN'::text) AS pais,
            l.snapshot_date,
            COALESCE(NULLIF(upper(TRIM(BOTH FROM CASE WHEN upper(l.disposition)='SELLABLE' AND (upper(l.condition_type) NOT IN ('NEW','NEWITEM') OR l.sku_original LIKE 'amzn.gr.%') THEN 'SELLABLE_OTHER_CONDITION' ELSE l.disposition END)), ''::text), 'UNKNOWN'::text) AS disposition,
            COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
            l.updated_at
           FROM (v_complete_fba_ledger_daily l
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
    (COALESCE(sum(stock) FILTER (WHERE (disposition NOT IN ('SELLABLE'::text,'SELLABLE_OTHER_CONDITION'::text))), (0)::numeric))::bigint AS stock_fba_unsellable,
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

CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_location AS
 WITH latest_snapshot AS (
         SELECT v_complete_fba_ledger_daily.producto_id,
            max(v_complete_fba_ledger_daily.snapshot_date) AS snapshot_date
           FROM v_complete_fba_ledger_daily
          WHERE (v_complete_fba_ledger_daily.producto_id IS NOT NULL) AND snapshot_date=(SELECT max(snapshot_date) FROM public.v_published_fba_ledger_daily)
          GROUP BY v_complete_fba_ledger_daily.producto_id
        ), chosen_document AS (
         SELECT DISTINCT ON (l.producto_id, l.snapshot_date) l.producto_id,
            l.snapshot_date,
            l.document_identity
           FROM (v_complete_fba_ledger_daily l
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
           FROM (v_complete_fba_ledger_daily l
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

COMMIT;
