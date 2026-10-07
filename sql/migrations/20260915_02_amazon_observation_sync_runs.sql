-- Immutable Amazon snapshots per execution. Legacy rows retain NULL run membership.
-- Apply only together with the run-aware writer. Old RPC callers fail closed after replacement.
begin;
create table public.finance_amazon_observation_runs (
  id uuid primary key,
  observed_at timestamptz not null,
  status text not null check (status in ('running','failed','succeeded')),
  published_at timestamptz,
  expected_counts jsonb,
  created_at timestamptz not null default now()
);
alter table public.finance_amazon_observation_runs enable row level security;
revoke all on public.finance_amazon_observation_runs from public,anon,authenticated;
grant select on public.finance_amazon_observation_runs to service_role;

alter table public.finance_amazon_treasury_forecast_snapshots
  add column sync_run_id uuid references public.finance_amazon_observation_runs(id),
  add constraint ck_amazon_observation_run_identity check (
    sync_run_id is null or (observation_key is not null and source_key is not null
      and economic_state in ('AVAILABLE','DEFERRED','PENDING_BANK'))
  );
comment on column public.finance_amazon_treasury_forecast_snapshots.sync_run_id is
  'Observation execution membership. NULL means legacy, never inferred or backfilled.';
drop index public.ux_amazon_treasury_snapshot_observation_key;
create unique index ux_amazon_treasury_snapshot_legacy_observation_key
  on public.finance_amazon_treasury_forecast_snapshots(observation_key)
  where sync_run_id is null and observation_key is not null;
create unique index ux_amazon_treasury_snapshot_run_observation_key
  on public.finance_amazon_treasury_forecast_snapshots(sync_run_id,observation_key)
  where sync_run_id is not null;
create unique index ux_amazon_treasury_snapshot_run_source_key
  on public.finance_amazon_treasury_forecast_snapshots(sync_run_id,source_key)
  where sync_run_id is not null;

-- Audited only canonical production caller: amazonFinancialPlanningSyncRepository.
-- Deployed 32-argument overload has no dependent database objects. No CASCADE.
drop function public.finance_insert_amazon_treasury_observation(
  p_observation_key text,
  p_source_key text,
  p_marketplace text,
  p_economic_state text,
  p_observed_at timestamptz,
  p_original_currency text,
  p_original_amount numeric,
  p_amount_eur numeric,
  p_official_amount_eur numeric,
  p_financial_event_group_id text,
  p_amazon_transaction_id text,
  p_transaction_status text,
  p_settlement_processing_status text,
  p_fund_transfer_status text,
  p_fund_transfer_at timestamptz,
  p_expected_availability_date date,
  p_expected_request_date date,
  p_expected_bank_date date,
  p_confidence text,
  p_estimation_method text,
  p_fx_source text,
  p_fx_observed_at timestamptz,
  p_fx_kind text,
  p_estimated_fx_rate numeric,
  p_realized_fx_rate numeric,
  p_realized_amount_eur numeric,
  p_amazon_transaction_type text,
  p_amazon_posted_at timestamptz,
  p_amazon_release_date date,
  p_amazon_deferral_reason text,
  p_source text,
  p_evidence jsonb
);

create or replace function public.finance_insert_amazon_treasury_observation(
  p_sync_run_id uuid,
  p_observation_key text,
  p_source_key text,
  p_marketplace text,
  p_economic_state text,
  p_observed_at timestamptz,
  p_original_currency text,
  p_original_amount numeric,
  p_amount_eur numeric,
  p_official_amount_eur numeric,
  p_financial_event_group_id text,
  p_amazon_transaction_id text,
  p_transaction_status text,
  p_settlement_processing_status text,
  p_fund_transfer_status text,
  p_fund_transfer_at timestamptz,
  p_expected_availability_date date,
  p_expected_request_date date,
  p_expected_bank_date date,
  p_confidence text,
  p_estimation_method text,
  p_fx_source text,
  p_fx_observed_at timestamptz,
  p_fx_kind text,
  p_estimated_fx_rate numeric,
  p_realized_fx_rate numeric,
  p_realized_amount_eur numeric,
  p_amazon_transaction_type text,
  p_amazon_posted_at timestamptz,
  p_amazon_release_date date,
  p_amazon_deferral_reason text,
  p_source text,
  p_evidence jsonb
) returns public.finance_amazon_treasury_forecast_snapshots
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.finance_amazon_treasury_forecast_snapshots;
  v_candidate public.finance_amazon_treasury_forecast_snapshots;
  v_run public.finance_amazon_observation_runs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_sync_run_id is null or p_observation_key is null or p_source_key is null or p_observed_at is null then
    raise exception 'AMAZON_SYNC_RUN_REQUIRED';
  end if;
  select null,p_observation_key,p_source_key,p_marketplace,p_economic_state,p_observed_at,p_original_currency,round(p_original_amount,2),
    round(p_amount_eur,2),round(p_official_amount_eur,2),case when p_fx_kind='ERP_ESTIMATED_FX' then round(p_amount_eur,2) end,
    p_estimated_fx_rate,round(p_realized_amount_eur,2),p_realized_fx_rate,p_fx_kind,p_financial_event_group_id,
    p_amazon_transaction_id,p_transaction_status,p_settlement_processing_status,p_fund_transfer_status,p_fund_transfer_at,
    p_expected_availability_date,p_expected_request_date,p_expected_bank_date,p_confidence,p_estimation_method,p_fx_source,
    p_fx_observed_at,nullif(btrim(p_amazon_transaction_type),''),p_amazon_posted_at,p_amazon_release_date,
    nullif(btrim(p_amazon_deferral_reason),''),coalesce(nullif(btrim(p_source),''),'amazon_sp_api'),coalesce(p_evidence,'{}'::jsonb)
  into v_candidate.forecast_id,v_candidate.observation_key,v_candidate.source_key,v_candidate.marketplace,v_candidate.economic_state,v_candidate.snapshot_at,v_candidate.original_currency,v_candidate.original_amount,v_candidate.amount_eur,v_candidate.official_amount_eur,v_candidate.estimated_amount_eur,v_candidate.estimated_fx_rate,v_candidate.realized_amount_eur,v_candidate.realized_fx_rate,v_candidate.fx_kind,v_candidate.financial_event_group_id,v_candidate.amazon_transaction_id,v_candidate.transaction_status,v_candidate.settlement_processing_status,v_candidate.fund_transfer_status,v_candidate.fund_transfer_at,v_candidate.expected_availability_date,v_candidate.expected_request_date,v_candidate.expected_bank_date,v_candidate.confidence,v_candidate.estimation_method,v_candidate.fx_source,v_candidate.fx_observed_at,v_candidate.amazon_transaction_type,v_candidate.amazon_posted_at,v_candidate.amazon_release_date,v_candidate.amazon_deferral_reason,v_candidate.source,v_candidate.evidence;
  v_candidate.sync_run_id:=p_sync_run_id;
  select * into v_row from public.finance_amazon_treasury_forecast_snapshots
    where sync_run_id=p_sync_run_id and observation_key=p_observation_key;
  if found then
    if (to_jsonb(v_row)-array['id','created_at']) is distinct from (to_jsonb(v_candidate)-array['id','created_at']) then
      raise exception 'AMAZON_RUN_OBSERVATION_MISMATCH';
    end if;
    return v_row;
  end if;
  -- Same lock order as acquire/finish. SHARE allows concurrent observation inserts;
  -- finish cannot certify/publish until they complete, and no insert can follow publication.
  perform 1 from public.finance_amazon_sync_state
    where sync_key='amazon_financial_planning' and run_id=p_sync_run_id and status='running' for share;
  if not found then raise exception 'AMAZON_SYNC_RUN_NOT_OWNED'; end if;
  select * into v_run from public.finance_amazon_observation_runs where id=p_sync_run_id for share;
  if not found or v_run.status<>'running' or v_run.observed_at is distinct from p_observed_at then
    raise exception 'AMAZON_SYNC_RUN_NOT_WRITABLE';
  end if;
  if p_economic_state not in ('DEFERRED','AVAILABLE','PENDING_BANK') then
    raise exception 'OBSERVATIONAL_SNAPSHOT_CANNOT_CREATE_RECEIVED';
  end if;
  if p_fx_kind not in ('AMAZON_REALIZED_FX','ERP_ESTIMATED_FX','UNAVAILABLE') then
    raise exception 'INVALID_AMAZON_FX_KIND';
  end if;
  insert into public.finance_amazon_treasury_forecast_snapshots(
    sync_run_id,forecast_id,observation_key,source_key,marketplace,economic_state,snapshot_at,original_currency,original_amount,
    amount_eur,official_amount_eur,estimated_amount_eur,estimated_fx_rate,realized_amount_eur,realized_fx_rate,fx_kind,
    financial_event_group_id,amazon_transaction_id,transaction_status,settlement_processing_status,fund_transfer_status,
    fund_transfer_at,expected_availability_date,expected_request_date,expected_bank_date,confidence,estimation_method,
    fx_source,fx_observed_at,amazon_transaction_type,amazon_posted_at,amazon_release_date,amazon_deferral_reason,
    source,evidence
  ) values (
    p_sync_run_id,null,p_observation_key,p_source_key,p_marketplace,p_economic_state,p_observed_at,p_original_currency,round(p_original_amount,2),
    round(p_amount_eur,2),round(p_official_amount_eur,2),case when p_fx_kind='ERP_ESTIMATED_FX' then round(p_amount_eur,2) end,
    p_estimated_fx_rate,round(p_realized_amount_eur,2),p_realized_fx_rate,p_fx_kind,p_financial_event_group_id,
    p_amazon_transaction_id,p_transaction_status,p_settlement_processing_status,p_fund_transfer_status,p_fund_transfer_at,
    p_expected_availability_date,p_expected_request_date,p_expected_bank_date,p_confidence,p_estimation_method,p_fx_source,
    p_fx_observed_at,nullif(btrim(p_amazon_transaction_type),''),p_amazon_posted_at,p_amazon_release_date,
    nullif(btrim(p_amazon_deferral_reason),''),coalesce(nullif(btrim(p_source),''),'amazon_sp_api'),coalesce(p_evidence,'{}'::jsonb)
  )
  on conflict (sync_run_id,observation_key) where sync_run_id is not null
  do nothing
  returning * into v_row;
  if not found then
    select * into v_row from public.finance_amazon_treasury_forecast_snapshots
      where sync_run_id=p_sync_run_id and observation_key=p_observation_key;
    if not found or (to_jsonb(v_row)-array['id','created_at']) is distinct from (to_jsonb(v_candidate)-array['id','created_at']) then
      raise exception 'AMAZON_RUN_OBSERVATION_MISMATCH';
    end if;
  end if;
  return v_row;
end;
$$;

revoke all on function public.finance_insert_amazon_treasury_observation(
  uuid,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,date,date,date,text,text,text,timestamptz,text,numeric,numeric,numeric,text,timestamptz,date,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.finance_insert_amazon_treasury_observation(
  uuid,text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,date,date,date,text,text,text,timestamptz,text,numeric,numeric,numeric,text,timestamptz,date,text,text,jsonb
) to service_role;


create or replace function public.finance_try_acquire_amazon_sync(p_run_id uuid,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_state public.finance_amazon_sync_state; v_run public.finance_amazon_observation_runs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_run_id is null or p_lease_seconds<30 or p_lease_seconds>900 then raise exception 'INVALID_SYNC_LEASE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-financial-planning-sync',0));
  select * into v_state from public.finance_amazon_sync_state where sync_key='amazon_financial_planning' for update;
  if not found then raise exception 'AMAZON_SYNC_STATE_MISSING'; end if;
  select * into v_run from public.finance_amazon_observation_runs where id=p_run_id;
  if v_run.status='succeeded' or (v_state.status='running' and v_state.locked_until>now()) then
    return jsonb_build_object('acquired',false,'runId',v_state.run_id,'lastSuccessfulAt',v_state.last_successful_at);
  end if;
  insert into public.finance_amazon_observation_runs(id,observed_at,status) values(p_run_id,now(),'running')
    on conflict(id) do update set status='running' returning * into v_run;
  update public.finance_amazon_sync_state set status='running',run_id=p_run_id,started_at=v_run.observed_at,
    finished_at=null,locked_until=now()+make_interval(secs=>p_lease_seconds),last_error=null,updated_at=now()
    where sync_key='amazon_financial_planning' returning * into v_state;
  return jsonb_build_object('acquired',true,'runId',p_run_id,'observedAt',v_run.observed_at,
    'status',v_state.status,'lockedUntil',v_state.locked_until,'lastSuccessfulAt',v_state.last_successful_at,'lastResult',v_state.last_result);
end $$;

create or replace function public.finance_finish_amazon_sync(p_run_id uuid,p_succeeded boolean,p_result jsonb,p_error text default null)
returns public.finance_amazon_sync_state language plpgsql security definer set search_path=public as $$
declare v_state public.finance_amazon_sync_state; v_run public.finance_amazon_observation_runs;
  v_counts jsonb; v_expected jsonb; v_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-financial-planning-sync',0));
  select * into v_state from public.finance_amazon_sync_state where sync_key='amazon_financial_planning' and run_id=p_run_id for update;
  if not found then raise exception 'AMAZON_SYNC_RUN_NOT_OWNED'; end if;
  select * into v_run from public.finance_amazon_observation_runs where id=p_run_id for update;
  if not found then raise exception 'AMAZON_SYNC_RUN_REQUIRED'; end if;
  if v_run.status='succeeded' then
    if p_succeeded and v_state.last_result=p_result then return v_state; end if;
    raise exception 'AMAZON_SYNC_RUN_ALREADY_PUBLISHED';
  end if;
  if v_state.status<>'running' then raise exception 'AMAZON_SYNC_RUN_NOT_RUNNING'; end if;
  if p_succeeded then
    v_expected:=p_result->'observations';
    if (v_expected->>'runId') is distinct from p_run_id::text
       or (v_expected->>'observedAt')::timestamptz is distinct from v_run.observed_at
       or v_expected->'errors' is distinct from '[]'::jsonb then
      raise exception 'AMAZON_RUN_COVERAGE_MISMATCH';
    end if;
    select jsonb_build_object('written',count(*),'available',count(*) filter(where economic_state='AVAILABLE'),
      'deferred',count(*) filter(where economic_state='DEFERRED'),'pendingBank',count(*) filter(where economic_state='PENDING_BANK'))
      into v_counts from public.finance_amazon_treasury_forecast_snapshots where sync_run_id=p_run_id;
    foreach v_key in array array['written','available','deferred','pendingBank'] loop
      if jsonb_typeof(v_expected->v_key) is distinct from 'number' or (v_expected->v_key) is distinct from (v_counts->v_key) then
        raise exception 'AMAZON_RUN_COVERAGE_MISMATCH';
      end if;
    end loop;
    update public.finance_amazon_observation_runs set status='succeeded',published_at=now(),expected_counts=v_counts where id=p_run_id;
  else
    update public.finance_amazon_observation_runs set status='failed' where id=p_run_id;
  end if;
  update public.finance_amazon_sync_state set status=case when p_succeeded then 'succeeded' else 'failed' end,
    locked_until=null,finished_at=now(),last_successful_at=case when p_succeeded then now() else last_successful_at end,
    last_result=case when p_succeeded then p_result else last_result end,
    last_error=case when p_succeeded then null else left(p_error,2000) end,updated_at=now()
    where sync_key='amazon_financial_planning' returning * into v_state;
  return v_state;
end $$;
revoke all on function public.finance_try_acquire_amazon_sync(uuid,integer) from public,anon,authenticated;
grant execute on function public.finance_try_acquire_amazon_sync(uuid,integer) to service_role;
revoke all on function public.finance_finish_amazon_sync(uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.finance_finish_amazon_sync(uuid,boolean,jsonb,text) to service_role;
commit;
