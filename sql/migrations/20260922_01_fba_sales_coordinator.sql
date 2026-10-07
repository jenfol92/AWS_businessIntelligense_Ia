-- Local preparation only. Reuses the existing report queue and scheduler leases.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fba_sales_active_request
ON public.amazon_spapi_report_jobs ((raw->'requestedCreateReportPayload'->>'salesCompatibilityKey'))
WHERE source='fba_sales_coordinator' AND status NOT IN ('COMPLETED','FAILED','FATAL');

CREATE OR REPLACE FUNCTION public.claim_fba_sales_sync(p_job_id uuid, p_initial jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE j public.amazon_spapi_report_jobs; r record; s jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL||||'));
  SELECT * INTO STRICT j FROM public.amazon_spapi_report_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.source <> 'fba_sales_coordinator' THEN RAISE EXCEPTION 'INVALID_SALES_JOB'; END IF;
  s := COALESCE(j.raw->'fbaSalesSync', p_initial);
  IF s IS NULL THEN RAISE EXCEPTION 'MISSING_SALES_STATE'; END IF;
  IF j.raw->'fbaSalesSync' IS NULL THEN
    UPDATE public.amazon_spapi_report_jobs SET raw=COALESCE(raw,'{}')||jsonb_build_object('fbaSalesSync',s,
      'salesCompatibilityKey',raw->'requestedCreateReportPayload'->'salesCompatibilityKey'), status='PENDING' WHERE id=j.id;
  END IF;
  IF s->>'status' IN ('COMPLETED','FAILED','FATAL') THEN
    RETURN jsonb_build_object('state',s,'runId',NULL);
  END IF;
  -- FIFO for all sales scopes: an older report cannot overwrite a newer publication.
  IF EXISTS (SELECT 1 FROM public.amazon_spapi_report_jobs q
    WHERE q.source='fba_sales_coordinator' AND (q.requested_at,q.id)<(j.requested_at,j.id)
      AND COALESCE(q.raw->'fbaSalesSync'->>'status','PENDING') NOT IN ('COMPLETED','FAILED','FATAL'))
    OR (s->>'nextAttemptAt')::timestamptz > clock_timestamp() THEN
    RETURN jsonb_build_object('state',s,'runId',NULL);
  END IF;
  SELECT * INTO r FROM public.start_amazon_report_sync_run(NULL,'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL',NULL,NULL,2);
  IF NOT r.started THEN RETURN jsonb_build_object('state',s,'runId',NULL); END IF;
  UPDATE public.amazon_report_sync_runs SET amazon_report_job_id=j.id WHERE id=r.run_id;
  RETURN jsonb_build_object('state',s,'runId',r.run_id);
END $$;

CREATE OR REPLACE FUNCTION public.assert_fba_sales_lease(p_job_id uuid,p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL||||'));
  PERFORM 1 FROM public.amazon_report_sync_runs WHERE id=p_run_id
    AND amazon_report_job_id=p_job_id AND report_type='GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
    AND status='RUNNING' AND lock_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FBA_SALES_LEASE_LOST'; END IF;
  PERFORM 1 FROM public.amazon_spapi_report_jobs WHERE id=p_job_id AND source='fba_sales_coordinator' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SALES_JOB'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.checkpoint_fba_sales_sync(p_job_id uuid,p_run_id uuid,p_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_fba_sales_lease(p_job_id,p_run_id);
  IF p_state->>'status'='COMPLETED' THEN RAISE EXCEPTION 'PUBLICATION_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM public.amazon_spapi_report_jobs WHERE id=p_job_id AND
    ((raw->'fbaSalesSync'->>'chunkIndex')::integer <> (p_state->>'chunkIndex')::integer OR
     raw->'fbaSalesSync'->>'status' IN ('COMPLETED','FAILED','FATAL'))) THEN RAISE EXCEPTION 'STALE_CHECKPOINT'; END IF;
  UPDATE public.amazon_spapi_report_jobs SET
    raw=COALESCE(raw,'{}')||jsonb_build_object('fbaSalesSync',p_state),
    status=p_state->>'status', error_message=p_state->>'error',
    report_id=COALESCE(p_state->'chunks'->((p_state->>'chunkIndex')::integer)->>'reportId',report_id),
    updated_at=clock_timestamp() WHERE id=p_job_id;
END $$;

-- The legacy SECURITY DEFINER canonical writer is internal to the fenced commit.
REVOKE ALL ON FUNCTION public.sync_ventas_diarias_from_amazon_fba_sales(date,date,text[],text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.commit_fba_sales_chunk(
  p_job_id uuid,p_run_id uuid,p_rows jsonb,p_marketplace_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb; c jsonb; result jsonb; completed jsonb; actual_commit timestamptz;
BEGIN
  PERFORM public.assert_fba_sales_lease(p_job_id,p_run_id);
  SELECT raw->'fbaSalesSync' INTO s FROM public.amazon_spapi_report_jobs WHERE id=p_job_id;
  c:=s->'chunks'->((s->>'chunkIndex')::integer);
  IF s->>'status' IN ('COMPLETED','FAILED','FATAL') OR c IS NULL THEN RAISE EXCEPTION 'INVALID_PUBLICATION_STATE'; END IF;
  IF s->>'mode'<>'syncOnly' AND (c->>'phase'<>'DOWNLOAD' OR c->>'reportId' IS NULL) THEN RAISE EXCEPTION 'DOCUMENT_NOT_READY'; END IF;
  IF s->>'mode'<>'syncOnly' AND (
    c->'diagnostic'->>'reportType' IS DISTINCT FROM 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
    OR c->'diagnostic'->>'processingStatus' IS DISTINCT FROM 'DONE'
    OR c->>'documentId' IS NULL
    OR c->'diagnostic'->>'reportDocumentId' IS DISTINCT FROM c->>'documentId'
    OR (c->'diagnostic'->>'dataStartTime')::timestamptz IS DISTINCT FROM ((c->>'fromDate')||'T00:00:00Z')::timestamptz
    OR (c->'diagnostic'->>'dataEndTime')::timestamptz IS DISTINCT FROM ((c->>'toDate')||'T23:59:59Z')::timestamptz
  ) THEN RAISE EXCEPTION 'REPORT_RANGE_OR_DOCUMENT_NOT_VERIFIED'; END IF;
  IF p_marketplace_ids IS NULL OR cardinality(p_marketplace_ids)=0 THEN RAISE EXCEPTION 'MISSING_MARKETPLACE_SCOPE'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_marketplace_ids) m WHERE NOT EXISTS(SELECT 1 FROM public.amazon_marketplaces a WHERE a.id=m)) THEN
    RAISE EXCEPTION 'FBA_SALES_MARKETPLACE_MISSING';
  END IF;
  IF jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'INVALID_RAW_ROWS'; END IF;
  IF s->>'mode'='syncOnly' AND jsonb_array_length(p_rows)>0 THEN RAISE EXCEPTION 'SYNC_ONLY_RAW_WRITE'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE
    (x->>'sale_date')::date < (c->>'fromDate')::date OR (x->>'sale_date')::date > (c->>'toDate')::date
    OR x->>'report_id' IS DISTINCT FROM c->>'reportId'
    OR x->'raw'->>'report_type' IS DISTINCT FROM 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL') THEN
    RAISE EXCEPTION 'RAW_OUTSIDE_VALIDATED_REPORT';
  END IF;
  INSERT INTO public.amazon_fba_sales_daily_raw
    (report_id,marketplace_id,sale_date,sku_original,sku_limpio,producto_id,quantity,amount,currency,
     ship_to_country,fulfillment_channel,sales_channel,row_fingerprint,raw,imported_at)
  SELECT report_id,marketplace_id,sale_date,sku_original,sku_limpio,producto_id,quantity,amount,currency,
     ship_to_country,fulfillment_channel,sales_channel,row_fingerprint,raw,imported_at
  FROM jsonb_populate_recordset(NULL::public.amazon_fba_sales_daily_raw,p_rows)
  ON CONFLICT(row_fingerprint) DO UPDATE SET
    report_id=excluded.report_id,marketplace_id=excluded.marketplace_id,sale_date=excluded.sale_date,
    sku_original=excluded.sku_original,sku_limpio=excluded.sku_limpio,producto_id=excluded.producto_id,
    quantity=excluded.quantity,amount=excluded.amount,currency=excluded.currency,ship_to_country=excluded.ship_to_country,
    fulfillment_channel=excluded.fulfillment_channel,sales_channel=excluded.sales_channel,
    raw=excluded.raw,imported_at=excluded.imported_at;
  result:=public.sync_ventas_diarias_from_amazon_fba_sales((c->>'fromDate')::date,(c->>'toDate')::date+1,
    p_marketplace_ids,s->>'tipoCliente','spapi_fba_customer_shipment_sales');
  result:=result||jsonb_build_object('rawRowsSubmitted',jsonb_array_length(p_rows),
    'unknownMarketplaceRows',(SELECT count(*) FROM jsonb_array_elements(p_rows) x WHERE COALESCE(x->>'marketplace_id','')=''));
  PERFORM public.assert_fba_sales_lease(p_job_id,p_run_id);
  -- Build authoritative progress in SQL, never trust a client's COMPLETED flag.
  actual_commit:=clock_timestamp();
  completed:=jsonb_set(s,ARRAY['chunks',s->>'chunkIndex'],c||jsonb_build_object('phase','COMPLETED','committedAt',actual_commit,'publication',result));
  completed:=completed||jsonb_build_object('chunkIndex',(s->>'chunkIndex')::integer+1,
    'status',CASE WHEN (s->>'chunkIndex')::integer+1=jsonb_array_length(s->'chunks') THEN 'COMPLETED' ELSE 'PENDING' END,
    'lastCommittedAt',actual_commit,'nextAttemptAt',NULL,'error',NULL);
  UPDATE public.amazon_spapi_report_jobs SET raw=raw||jsonb_build_object('fbaSalesSync',completed,'lastPublication',result),
    status=completed->>'status',error_message=NULL,updated_at=actual_commit,
    completed_at=CASE WHEN completed->>'status'='COMPLETED' THEN actual_commit ELSE NULL END WHERE id=p_job_id;
  IF completed->>'status'='COMPLETED' THEN
    INSERT INTO public.amazon_sync_jobs(job_key,last_run_at,last_success_at,last_status,last_error,last_rows_upserted,updated_at)
      VALUES('amazon_fba_sales_to_ventas_diarias',actual_commit,actual_commit,'SUCCESS',NULL,
        (SELECT COALESCE(sum((x->'publication'->>'inserted')::integer),0) FROM jsonb_array_elements(completed->'chunks') x),actual_commit)
      ON CONFLICT(job_key) DO UPDATE SET last_run_at=excluded.last_run_at,last_success_at=excluded.last_success_at,
        last_status=excluded.last_status,last_error=NULL,last_rows_upserted=excluded.last_rows_upserted,updated_at=excluded.updated_at;
  END IF;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.claim_fba_sales_sync(uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.assert_fba_sales_lease(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_fba_sales_sync(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commit_fba_sales_chunk(uuid,uuid,jsonb,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fba_sales_sync(uuid,jsonb),public.assert_fba_sales_lease(uuid,uuid),
 public.checkpoint_fba_sales_sync(uuid,uuid,jsonb),public.commit_fba_sales_chunk(uuid,uuid,jsonb,text[]) TO service_role;
COMMIT;
