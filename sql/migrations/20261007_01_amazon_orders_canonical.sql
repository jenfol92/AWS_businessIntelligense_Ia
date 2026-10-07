-- PREPARED ONLY. No backfill, no legacy/inventory/forecast writes.
BEGIN;
ALTER TABLE public.amazon_order_items
  ADD COLUMN IF NOT EXISTS purchase_datetime_original text,
  ADD COLUMN IF NOT EXISTS fulfillment_channel_original text,
  ADD COLUMN IF NOT EXISTS amazon_order_item_id text,
  ADD COLUMN IF NOT EXISTS marketplace_classification text,
  ADD COLUMN IF NOT EXISTS purchase_timezone text,
  ADD COLUMN IF NOT EXISTS identity_resolution jsonb,
  ADD COLUMN IF NOT EXISTS report_observed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.amazon_orders_operations (
  job_id uuid PRIMARY KEY REFERENCES public.amazon_spapi_report_jobs(id),
  state jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  lease_token uuid, lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.amazon_orders_coverage (
  job_id uuid NOT NULL REFERENCES public.amazon_orders_operations(job_id),
  marketplace_id text NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETE','PARTIAL','IN_PROGRESS','FAILED')),
  report_id text, report_document_id text, completed_at timestamptz,
  data_start_time timestamptz NOT NULL, data_end_time timestamptz NOT NULL,
  rows_committed integer NOT NULL DEFAULT 0,
  PRIMARY KEY(job_id, marketplace_id, start_date), CHECK (end_date >= start_date),
  CHECK (status <> 'COMPLETE' OR (report_id IS NOT NULL AND report_document_id IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS amazon_orders_single_active_operation
  ON public.amazon_orders_operations((true)) WHERE status='PENDING';
ALTER TABLE public.amazon_orders_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amazon_orders_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amazon_orders_operations, public.amazon_orders_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.amazon_orders_operations, public.amazon_orders_coverage TO service_role;

CREATE OR REPLACE FUNCTION public.begin_amazon_orders_operation(p_state jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing public.amazon_orders_operations; job uuid; w jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('all_orders_canonical_v1'));
  SELECT * INTO existing FROM amazon_orders_operations WHERE status='PENDING' ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF existing.state->>'fromDate' IS DISTINCT FROM p_state->>'fromDate'
       OR existing.state->>'toDate' IS DISTINCT FROM p_state->>'toDate'
       OR existing.state->'marketplaceIds' IS DISTINCT FROM p_state->'marketplaceIds' THEN
      RAISE EXCEPTION 'ALL_ORDERS_RANGE_CONFLICT';
    END IF;
    RETURN existing.job_id;
  END IF;
  IF p_state->>'version' <> '1' OR jsonb_array_length(p_state->'windows') < 1 THEN RAISE EXCEPTION 'ALL_ORDERS_INVALID_STATE'; END IF;
  INSERT INTO amazon_spapi_report_jobs(report_type,marketplace_ids,status,source,raw)
  VALUES ('GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL',ARRAY(SELECT jsonb_array_elements_text(p_state->'marketplaceIds')),'CREATED','all_orders_canonical_v1',p_state) RETURNING id INTO job;
  INSERT INTO amazon_orders_operations(job_id,state,status) VALUES(job,p_state,'PENDING');
  FOR w IN SELECT * FROM jsonb_array_elements(p_state->'windows') LOOP
    INSERT INTO amazon_orders_coverage(job_id,marketplace_id,start_date,end_date,status,data_start_time,data_end_time)
    VALUES(job,w->>'marketplaceId',(w->>'fromDate')::date,(w->>'toDate')::date,'IN_PROGRESS',(w->>'dataStartTime')::timestamptz,(w->>'dataEndTime')::timestamptz);
  END LOOP;
  RETURN job;
END $$;

CREATE OR REPLACE FUNCTION public.lease_amazon_orders_operation(p_job uuid, p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.amazon_orders_operations;
BEGIN
  SELECT * INTO op FROM amazon_orders_operations WHERE job_id=p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ALL_ORDERS_OPERATION_NOT_FOUND'; END IF;
  IF op.status <> 'PENDING' OR (op.state->>'nextAttemptAt')::timestamptz > now()
    OR op.lease_expires_at > now() THEN RETURN NULL; END IF;
  UPDATE amazon_orders_operations SET lease_token=p_token,lease_expires_at=now()+interval '3 minutes',updated_at=now() WHERE job_id=p_job;
  RETURN op.state;
END $$;

-- Atomic import + evidence of coverage + state checkpoint, fenced by lease.
CREATE OR REPLACE FUNCTION public.save_amazon_orders_operation(p_job uuid,p_token uuid,p_state jsonb,p_rows jsonb DEFAULT '[]') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.amazon_orders_operations; w jsonb; overall text; previous_manifest jsonb; new_manifest jsonb;
BEGIN
  SELECT * INTO op FROM amazon_orders_operations WHERE job_id=p_job FOR UPDATE;
  IF NOT FOUND OR op.lease_token IS DISTINCT FROM p_token OR op.lease_expires_at <= now() THEN RAISE EXCEPTION 'ALL_ORDERS_LEASE_LOST'; END IF;
  IF op.status <> 'PENDING' THEN RAISE EXCEPTION 'ALL_ORDERS_OPERATION_TERMINAL'; END IF;
  IF p_state->>'fromDate' IS DISTINCT FROM op.state->>'fromDate' OR p_state->>'toDate' IS DISTINCT FROM op.state->>'toDate' OR p_state->'marketplaceIds' IS DISTINCT FROM op.state->'marketplaceIds' THEN RAISE EXCEPTION 'ALL_ORDERS_SCOPE_CHANGED'; END IF;
  SELECT jsonb_agg(jsonb_build_array(x->>'marketplaceId',x->>'country',x->>'fromDate',x->>'toDate',x->>'dataStartTime',x->>'dataEndTime',x->>'coverageStatus') ORDER BY ord)
  INTO previous_manifest FROM jsonb_array_elements(op.state->'windows') WITH ORDINALITY a(x,ord);
  SELECT jsonb_agg(jsonb_build_array(x->>'marketplaceId',x->>'country',x->>'fromDate',x->>'toDate',x->>'dataStartTime',x->>'dataEndTime',x->>'coverageStatus') ORDER BY ord)
  INTO new_manifest FROM jsonb_array_elements(p_state->'windows') WITH ORDINALITY a(x,ord);
  IF previous_manifest IS DISTINCT FROM new_manifest THEN RAISE EXCEPTION 'ALL_ORDERS_MANIFEST_CHANGED'; END IF;
  IF jsonb_array_length(p_rows)>0 THEN
    INSERT INTO amazon_order_items(purchase_datetime_original,producto_id,amazon_order_id,merchant_order_id,seller_sku,asin,purchase_datetime,purchase_date,last_updated_datetime,order_status,item_status,fulfillment_channel,sales_channel,marketplace_country,ship_country,quantity,currency,item_price,item_tax,shipping_price,item_promotion_discount,is_business_order,row_fingerprint,report_id,fulfillment_channel_original,amazon_order_item_id,marketplace_classification,purchase_timezone,identity_resolution,report_observed_at,updated_at)
    SELECT r.purchase_datetime_original,r.producto_id,r.amazon_order_id,r.merchant_order_id,r.seller_sku,r.asin,r.purchase_datetime,r.purchase_date,r.last_updated_datetime,r.order_status,r.item_status,r.fulfillment_channel,r.sales_channel,r.marketplace_country,r.ship_country,r.quantity,r.currency,r.item_price,r.item_tax,r.shipping_price,r.item_promotion_discount,r.is_business_order,r.row_fingerprint,r.report_id,r.fulfillment_channel_original,r.amazon_order_item_id,r.marketplace_classification,r.purchase_timezone,r.identity_resolution,r.report_observed_at,now()
    FROM jsonb_populate_recordset(NULL::amazon_order_items,p_rows) r
    ON CONFLICT(row_fingerprint) DO UPDATE SET
      producto_id=excluded.producto_id,merchant_order_id=excluded.merchant_order_id,
      purchase_datetime=excluded.purchase_datetime,purchase_date=excluded.purchase_date,
      last_updated_datetime=excluded.last_updated_datetime,order_status=excluded.order_status,item_status=excluded.item_status,
      fulfillment_channel=excluded.fulfillment_channel,sales_channel=excluded.sales_channel,marketplace_country=excluded.marketplace_country,ship_country=excluded.ship_country,
      quantity=excluded.quantity,currency=excluded.currency,item_price=excluded.item_price,item_tax=excluded.item_tax,shipping_price=excluded.shipping_price,item_promotion_discount=excluded.item_promotion_discount,is_business_order=excluded.is_business_order,
      report_id=excluded.report_id,purchase_datetime_original=excluded.purchase_datetime_original,fulfillment_channel_original=excluded.fulfillment_channel_original,amazon_order_item_id=excluded.amazon_order_item_id,
      marketplace_classification=excluded.marketplace_classification,purchase_timezone=excluded.purchase_timezone,identity_resolution=excluded.identity_resolution,report_observed_at=excluded.report_observed_at,updated_at=now()
    WHERE coalesce(excluded.last_updated_datetime,excluded.report_observed_at) >= coalesce(amazon_order_items.last_updated_datetime,amazon_order_items.report_observed_at,'-infinity'::timestamptz);
  END IF;
  overall := CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'windows') x WHERE x->>'phase'='FAILED') THEN 'FAILED'
    WHEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'windows') x WHERE x->>'phase'<>'COMPLETE') THEN 'COMPLETED' ELSE 'PENDING' END;
  UPDATE amazon_orders_operations SET state=p_state,status=overall,updated_at=now() WHERE job_id=p_job;
  UPDATE amazon_spapi_report_jobs SET raw=p_state,status=CASE overall WHEN 'PENDING' THEN 'IN_PROGRESS' ELSE overall END,
    error_message=p_state->>'error',completed_at=CASE WHEN overall='PENDING' THEN NULL ELSE now() END,updated_at=now()
    WHERE id=p_job AND source='all_orders_canonical_v1';
  FOR w IN SELECT * FROM jsonb_array_elements(p_state->'windows') LOOP
    UPDATE amazon_orders_coverage SET status=CASE WHEN w->>'phase'='COMPLETE' THEN w->>'coverageStatus' WHEN overall='FAILED' THEN 'FAILED' ELSE 'IN_PROGRESS' END,
      report_id=w->>'reportId',report_document_id=w->>'documentId',completed_at=(w->>'completedAt')::timestamptz,rows_committed=coalesce((w->>'rowsUpserted')::integer,0)
    WHERE job_id=p_job AND marketplace_id=w->>'marketplaceId' AND start_date=(w->>'fromDate')::date;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.release_amazon_orders_operation(p_job uuid,p_token uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE amazon_orders_operations SET lease_token=NULL,lease_expires_at=NULL WHERE job_id=p_job AND lease_token=p_token;
$$;
REVOKE ALL ON FUNCTION public.begin_amazon_orders_operation(jsonb),public.lease_amazon_orders_operation(uuid,uuid),public.save_amazon_orders_operation(uuid,uuid,jsonb,jsonb),public.release_amazon_orders_operation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_amazon_orders_operation(jsonb),public.lease_amazon_orders_operation(uuid,uuid),public.save_amazon_orders_operation(uuid,uuid,jsonb,jsonb),public.release_amazon_orders_operation(uuid,uuid) TO service_role;
COMMIT;
