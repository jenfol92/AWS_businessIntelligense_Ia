begin;

create table if not exists public.finance_amazon_sync_state (
  sync_key text primary key,
  status text not null check (status in ('idle','running','succeeded','failed')),
  locked_until timestamptz,
  run_id uuid,
  started_at timestamptz,
  finished_at timestamptz,
  last_successful_at timestamptz,
  last_error text,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

insert into public.finance_amazon_sync_state(sync_key,status)
values ('amazon_financial_planning','idle')
on conflict (sync_key) do nothing;

alter table public.finance_amazon_sync_state enable row level security;
revoke all on public.finance_amazon_sync_state from public,anon,authenticated;
grant select,insert,update on public.finance_amazon_sync_state to service_role;

create or replace function public.finance_try_acquire_amazon_sync(
  p_run_id uuid,
  p_lease_seconds integer default 300
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.finance_amazon_sync_state%rowtype;v_acquired boolean:=false;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  if p_run_id is null or p_lease_seconds<30 or p_lease_seconds>900 then raise exception 'INVALID_SYNC_LEASE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-financial-planning-sync',0));
  select * into v_state from public.finance_amazon_sync_state where sync_key='amazon_financial_planning' for update;
  if v_state.status<>'running' or v_state.locked_until is null or v_state.locked_until<=now() then
    update public.finance_amazon_sync_state set status='running',run_id=p_run_id,started_at=now(),finished_at=null,
      locked_until=now()+make_interval(secs=>p_lease_seconds),last_error=null,updated_at=now()
    where sync_key='amazon_financial_planning' returning * into v_state;
    v_acquired:=true;
  end if;
  return jsonb_build_object('acquired',v_acquired,'runId',v_state.run_id,'status',v_state.status,
    'lockedUntil',v_state.locked_until,'lastSuccessfulAt',v_state.last_successful_at,'lastResult',v_state.last_result);
end $$;

create or replace function public.finance_finish_amazon_sync(
  p_run_id uuid,p_succeeded boolean,p_result jsonb,p_error text default null
) returns public.finance_amazon_sync_state
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state public.finance_amazon_sync_state%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-financial-planning-sync',0));
  update public.finance_amazon_sync_state set
    status=case when p_succeeded then 'succeeded' else 'failed' end,
    locked_until=null,finished_at=now(),last_successful_at=case when p_succeeded then now() else last_successful_at end,
    last_result=case when p_succeeded then p_result else last_result end,last_error=case when p_succeeded then null else left(p_error,2000) end,
    updated_at=now()
  where sync_key='amazon_financial_planning' and run_id=p_run_id returning * into v_state;
  if not found then raise exception 'AMAZON_SYNC_RUN_NOT_OWNED'; end if;
  return v_state;
end $$;

revoke all on function public.finance_try_acquire_amazon_sync(uuid,integer) from public,anon,authenticated;
grant execute on function public.finance_try_acquire_amazon_sync(uuid,integer) to service_role;
revoke all on function public.finance_finish_amazon_sync(uuid,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.finance_finish_amazon_sync(uuid,boolean,jsonb,text) to service_role;

-- A settlement cycle is compatible with the single marketplace/month forecast it overlaps.
-- Exact equality is intentionally not required because Amazon settlement groups are commonly sub-monthly.
create or replace function public.finance_reconcile_amazon_settlement(
  p_settlement_id text,p_marketplace text,p_currency text,p_amount numeric,p_cycle_start date,p_cycle_end date,
  p_fund_transfer_at timestamptz,p_fund_transfer_status text,p_trace_id text,p_processing_status text,p_source_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_settlement_id text:=nullif(btrim(p_settlement_id),'');v_marketplace text:=nullif(btrim(p_marketplace),'');
  v_currency text:=upper(nullif(btrim(p_currency),''));v_amount numeric(14,2);v_existing public.finance_amazon_income_forecasts%rowtype;
  v_candidate public.finance_amazon_income_forecasts%rowtype;v_candidates integer;v_status text;v_issue text;
  v_effective_date date;v_date_estimated boolean;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_settlement_id is null or v_marketplace is null or v_currency is null then raise exception 'REQUIRED_FIELDS'; end if;
  if p_processing_status is distinct from 'Closed' then raise exception 'SETTLEMENT_NOT_CLOSED'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_amount,'settlement_amount'),2);
  perform pg_advisory_xact_lock(hashtextextended('amazon-settlement:'||v_settlement_id,0));
  select * into v_existing from public.finance_amazon_income_forecasts where settlement_id=v_settlement_id for update;
  if found then
    if v_existing.marketplace is distinct from v_marketplace or v_existing.settlement_currency is distinct from v_currency
       or v_existing.settlement_amount is distinct from v_amount or v_existing.cycle_start is distinct from p_cycle_start
       or v_existing.cycle_end is distinct from p_cycle_end then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('outcome',v_existing.reconciliation_status,'forecastId',case when v_existing.reconciliation_status='matched' then v_existing.id else null end,
      'candidateCount',case when v_existing.reconciliation_status='ambiguous' then 2 when v_existing.reconciliation_status='unmatched' then 0 else 1 end,'idempotent',true);
  end if;
  select count(*) into v_candidates from public.finance_amazon_income_forecasts
   where lower(status) in ('projected','accumulated','previsto') and settlement_id is null and marketplace=v_marketplace
     and (p_cycle_start is null or cycle_end is null or cycle_end>=p_cycle_start)
     and (p_cycle_end is null or cycle_start is null or cycle_start<=p_cycle_end);
  v_status:=case when v_candidates=1 then 'matched' when v_candidates=0 then 'unmatched' else 'ambiguous' end;
  v_issue:=case when v_candidates=0 then 'NO_FORECAST_CANDIDATE' when v_candidates>1 then 'MULTIPLE_FORECAST_CANDIDATES:'||v_candidates else null end;
  v_effective_date:=coalesce(p_fund_transfer_at::date,p_cycle_end,p_cycle_start,current_date);v_date_estimated:=p_fund_transfer_at is null;
  if v_candidates=1 then
    select * into v_candidate from public.finance_amazon_income_forecasts
     where lower(status) in ('projected','accumulated','previsto') and settlement_id is null and marketplace=v_marketplace
       and (p_cycle_start is null or cycle_end is null or cycle_end>=p_cycle_start)
       and (p_cycle_end is null or cycle_start is null or cycle_start<=p_cycle_end) for update;
    update public.finance_amazon_income_forecasts set status='confirmed',forecast_date=v_effective_date,confirmed_amount_eur=v_amount,amount_eur=v_amount,
      settlement_id=v_settlement_id,settlement_currency=v_currency,settlement_amount=v_amount,settlement_processing_status=p_processing_status,
      fund_transfer_status=nullif(btrim(p_fund_transfer_status),''),fund_transfer_at=p_fund_transfer_at,trace_id=nullif(btrim(p_trace_id),''),
      reconciliation_status='matched',reconciliation_issue=null,confirmed_date_estimated=v_date_estimated,settlement_source_payload=p_source_payload,updated_at=now()
     where id=v_candidate.id returning * into v_candidate;
  else
    insert into public.finance_amazon_income_forecasts(source_key,forecast_date,description,amount_eur,status,marketplace,cycle_start,cycle_end,
      confirmed_amount_eur,settlement_id,settlement_currency,settlement_amount,settlement_processing_status,fund_transfer_status,fund_transfer_at,trace_id,
      reconciliation_status,reconciliation_issue,confirmed_date_estimated,settlement_source_payload,updated_at)
    values('settlement:'||v_settlement_id,v_effective_date,'Liquidacion Amazon '||v_settlement_id,v_amount,'confirmed',v_marketplace,p_cycle_start,p_cycle_end,
      v_amount,v_settlement_id,v_currency,v_amount,p_processing_status,nullif(btrim(p_fund_transfer_status),''),p_fund_transfer_at,nullif(btrim(p_trace_id),''),
      v_status,v_issue,v_date_estimated,p_source_payload,now()) returning * into v_candidate;
  end if;
  return jsonb_build_object('outcome',v_status,'forecastId',case when v_status='matched' then v_candidate.id else null end,'candidateCount',v_candidates,'idempotent',false);
end $$;

commit;
