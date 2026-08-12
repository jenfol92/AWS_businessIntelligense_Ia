begin;

alter table public.finance_amazon_income_forecasts
  add column if not exists settlement_id text,
  add column if not exists settlement_currency text,
  add column if not exists settlement_amount numeric(14,2),
  add column if not exists settlement_processing_status text,
  add column if not exists fund_transfer_status text,
  add column if not exists fund_transfer_at timestamptz,
  add column if not exists trace_id text,
  add column if not exists reconciliation_status text not null default 'not_applicable',
  add column if not exists reconciliation_issue text,
  add column if not exists confirmed_date_estimated boolean not null default false,
  add column if not exists settlement_source_payload jsonb;

create unique index if not exists finance_amazon_income_forecasts_settlement_id_uq
  on public.finance_amazon_income_forecasts(settlement_id)
  where settlement_id is not null;

alter table public.finance_amazon_income_forecasts
  drop constraint if exists finance_amazon_income_reconciliation_status_check;
alter table public.finance_amazon_income_forecasts
  add constraint finance_amazon_income_reconciliation_status_check
  check (reconciliation_status in ('not_applicable','matched','unmatched','ambiguous'));

create or replace function public.finance_upsert_amazon_income(
  p_source_key text,p_forecast_date date,p_description text,p_amount_eur numeric,p_status text,
  p_marketplace text,p_cycle_start date,p_cycle_end date,p_estimated_gross_eur numeric,
  p_historical_net_ratio numeric,p_confirmed_amount_eur numeric,p_notes text
) returns public.finance_amazon_income_forecasts
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.finance_amazon_income_forecasts%rowtype;v_key text:=nullif(btrim(p_source_key),'');v_amount numeric(14,2);
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_key is null or p_forecast_date is null or nullif(btrim(p_description),'') is null then raise exception 'REQUIRED_FIELDS'; end if;
  if lower(btrim(coalesce(p_status,'')))<>'projected' then raise exception 'FORECAST_MUST_BE_PROJECTED'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_amount_eur,'amount_eur'),2);
  if p_estimated_gross_eur is null or not public.finance_is_finite_numeric(p_estimated_gross_eur) or p_estimated_gross_eur<=0 then raise exception 'ESTIMATED_GROSS_REQUIRED'; end if;
  if p_historical_net_ratio is null or not public.finance_is_finite_numeric(p_historical_net_ratio) or p_historical_net_ratio<0 or p_historical_net_ratio>1 then raise exception 'INVALID_NET_RATIO'; end if;
  if v_amount is distinct from round(p_estimated_gross_eur*p_historical_net_ratio,2) then raise exception 'INCONSISTENT_PROJECTED_AMOUNT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-income-source:'||v_key,0));
  select * into v_row from public.finance_amazon_income_forecasts where source_key=v_key for update;
  if found and lower(v_row.status) not in ('projected','accumulated','previsto') then raise exception 'INCOME_LIFECYCLE_LOCKED'; end if;
  if found then
    update public.finance_amazon_income_forecasts set forecast_date=p_forecast_date,description=btrim(p_description),amount_eur=v_amount,status='projected',marketplace=nullif(btrim(p_marketplace),''),cycle_start=p_cycle_start,cycle_end=p_cycle_end,estimated_gross_eur=round(p_estimated_gross_eur,2),historical_net_ratio=p_historical_net_ratio,confirmed_amount_eur=null,notes=nullif(btrim(p_notes),''),updated_at=now() where id=v_row.id returning * into v_row;
  else
    insert into public.finance_amazon_income_forecasts(source_key,forecast_date,description,amount_eur,status,marketplace,cycle_start,cycle_end,estimated_gross_eur,historical_net_ratio,confirmed_amount_eur,notes,updated_at)
    values(v_key,p_forecast_date,btrim(p_description),v_amount,'projected',nullif(btrim(p_marketplace),''),p_cycle_start,p_cycle_end,round(p_estimated_gross_eur,2),p_historical_net_ratio,null,nullif(btrim(p_notes),''),now()) returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.finance_reconcile_amazon_settlement(
  p_settlement_id text,
  p_marketplace text,
  p_currency text,
  p_amount numeric,
  p_cycle_start date,
  p_cycle_end date,
  p_fund_transfer_at timestamptz,
  p_fund_transfer_status text,
  p_trace_id text,
  p_processing_status text,
  p_source_payload jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_settlement_id text:=nullif(btrim(p_settlement_id),'');
  v_marketplace text:=nullif(btrim(p_marketplace),'');
  v_currency text:=upper(nullif(btrim(p_currency),''));
  v_amount numeric(14,2);
  v_existing public.finance_amazon_income_forecasts%rowtype;
  v_candidate public.finance_amazon_income_forecasts%rowtype;
  v_candidates integer;
  v_reconciliation_status text;
  v_issue text;
  v_effective_date date;
  v_date_estimated boolean;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_settlement_id is null or v_marketplace is null or v_currency is null then raise exception 'REQUIRED_FIELDS'; end if;
  if p_processing_status is distinct from 'Closed' then raise exception 'SETTLEMENT_NOT_CLOSED'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_amount,'settlement_amount'),2);
  perform pg_advisory_xact_lock(hashtextextended('amazon-settlement:'||v_settlement_id,0));

  select * into v_existing from public.finance_amazon_income_forecasts
  where settlement_id=v_settlement_id for update;
  if found then
    if v_existing.marketplace is distinct from v_marketplace
       or v_existing.settlement_currency is distinct from v_currency
       or v_existing.settlement_amount is distinct from v_amount
       or v_existing.cycle_start is distinct from p_cycle_start
       or v_existing.cycle_end is distinct from p_cycle_end then
      raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    return jsonb_build_object('outcome',v_existing.reconciliation_status,'forecastId',case when v_existing.reconciliation_status='matched' then v_existing.id else null end,'candidateCount',case when v_existing.reconciliation_status='ambiguous' then 2 when v_existing.reconciliation_status='unmatched' then 0 else 1 end,'idempotent',true);
  end if;

  select count(*) into v_candidates
  from public.finance_amazon_income_forecasts
  where lower(status) in ('projected','accumulated','previsto')
    and settlement_id is null
    and marketplace=v_marketplace
    and cycle_start is not distinct from p_cycle_start
    and cycle_end is not distinct from p_cycle_end;

  v_reconciliation_status:=case when v_candidates=1 then 'matched' when v_candidates=0 then 'unmatched' else 'ambiguous' end;
  v_issue:=case when v_candidates=0 then 'NO_FORECAST_CANDIDATE' when v_candidates>1 then 'MULTIPLE_FORECAST_CANDIDATES:'||v_candidates else null end;
  v_effective_date:=coalesce(p_fund_transfer_at::date,p_cycle_end,p_cycle_start,current_date);
  v_date_estimated:=p_fund_transfer_at is null;

  if v_candidates=1 then
    select * into v_candidate from public.finance_amazon_income_forecasts
    where lower(status) in ('projected','accumulated','previsto') and settlement_id is null
      and marketplace=v_marketplace and cycle_start is not distinct from p_cycle_start
      and cycle_end is not distinct from p_cycle_end for update;
    update public.finance_amazon_income_forecasts set
      status='confirmed', forecast_date=v_effective_date, confirmed_amount_eur=v_amount,
      amount_eur=v_amount, settlement_id=v_settlement_id, settlement_currency=v_currency,
      settlement_amount=v_amount, settlement_processing_status=p_processing_status,
      fund_transfer_status=nullif(btrim(p_fund_transfer_status),''), fund_transfer_at=p_fund_transfer_at,
      trace_id=nullif(btrim(p_trace_id),''), reconciliation_status='matched', reconciliation_issue=null,
      confirmed_date_estimated=v_date_estimated, settlement_source_payload=p_source_payload, updated_at=now()
    where id=v_candidate.id returning * into v_candidate;
  else
    insert into public.finance_amazon_income_forecasts(
      source_key,forecast_date,description,amount_eur,status,marketplace,cycle_start,cycle_end,
      confirmed_amount_eur,settlement_id,settlement_currency,settlement_amount,
      settlement_processing_status,fund_transfer_status,fund_transfer_at,trace_id,
      reconciliation_status,reconciliation_issue,confirmed_date_estimated,settlement_source_payload,updated_at
    ) values(
      'settlement:'||v_settlement_id,v_effective_date,'Liquidacion Amazon '||v_settlement_id,v_amount,'confirmed',
      v_marketplace,p_cycle_start,p_cycle_end,v_amount,v_settlement_id,v_currency,v_amount,
      p_processing_status,nullif(btrim(p_fund_transfer_status),''),p_fund_transfer_at,nullif(btrim(p_trace_id),''),
      v_reconciliation_status,v_issue,v_date_estimated,p_source_payload,now()
    ) returning * into v_candidate;
  end if;
  return jsonb_build_object('outcome',v_reconciliation_status,'forecastId',case when v_reconciliation_status='matched' then v_candidate.id else null end,'candidateCount',v_candidates,'idempotent',false);
end $$;

create or replace function public.finance_receive_amazon_income(
  p_forecast_id uuid,p_cash_account_id uuid,p_received_amount_eur numeric,
  p_received_at timestamptz,p_reference text,p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_forecast public.finance_amazon_income_forecasts%rowtype;
  v_account public.finance_cash_accounts%rowtype;
  v_amount numeric(14,2); v_key text:=nullif(btrim(p_idempotency_key),''); v_expected_key text;
  v_movement_id uuid:=gen_random_uuid();
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if p_received_at is null or v_key is null then raise exception 'REQUIRED_FIELDS'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_received_amount_eur,'received_amount_eur'),2);
  select * into v_forecast from public.finance_amazon_income_forecasts where id=p_forecast_id for update;
  if not found then raise exception 'NOT_FOUND: forecast'; end if;
  if v_forecast.settlement_id is null or v_forecast.reconciliation_status<>'matched' then raise exception 'SETTLEMENT_RECONCILIATION_REQUIRED'; end if;
  v_expected_key:='amazon-receive:'||v_forecast.settlement_id;
  if v_key<>v_expected_key then raise exception 'INVALID_RECEIPT_IDEMPOTENCY_KEY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_expected_key,0));
  if v_forecast.status='received' then
    if v_forecast.idempotency_key is distinct from v_key or v_forecast.received_amount_eur is distinct from v_amount or v_forecast.cash_account_id is distinct from p_cash_account_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('forecast_id',v_forecast.id,'cash_movement_id',v_forecast.cash_movement_id,'received_amount_eur',v_forecast.received_amount_eur,'idempotent',true);
  end if;
  if v_forecast.status<>'confirmed' then raise exception 'CONFIRMED_SETTLEMENT_REQUIRED'; end if;
  select * into v_account from public.finance_cash_accounts where id=p_cash_account_id for update;
  if not found or not v_account.is_operating_treasury then raise exception 'NOT_OPERATING_TREASURY_ACCOUNT'; end if;
  insert into public.finance_cash_movements(id,cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes)
  values(v_movement_id,v_account.id,'income','in',v_amount,'amazon_income_forecast',v_forecast.id,p_received_at::date,nullif(btrim(p_reference),''));
  update public.finance_cash_accounts set balance=round(balance+v_amount,2),updated_at=now() where id=v_account.id returning * into v_account;
  update public.finance_amazon_income_forecasts set status='received',received_amount_eur=v_amount,received_at=p_received_at,cash_account_id=v_account.id,cash_movement_id=v_movement_id,idempotency_key=v_key,updated_at=now() where id=v_forecast.id returning * into v_forecast;
  return jsonb_build_object('forecast_id',v_forecast.id,'cash_movement_id',v_movement_id,'received_amount_eur',v_amount,'cash_balance_eur',v_account.balance,'idempotent',false);
end $$;

revoke all on function public.finance_reconcile_amazon_settlement(text,text,text,numeric,date,date,timestamptz,text,text,text,jsonb) from public,anon;
grant execute on function public.finance_reconcile_amazon_settlement(text,text,text,numeric,date,date,timestamptz,text,text,text,jsonb) to authenticated,service_role;
revoke all on function public.finance_upsert_amazon_income(text,date,text,numeric,text,text,date,date,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.finance_upsert_amazon_income(text,date,text,numeric,text,text,date,date,numeric,numeric,numeric,text) to authenticated,service_role;
revoke all on function public.finance_receive_amazon_income(uuid,uuid,numeric,timestamptz,text,text) from public,anon;
grant execute on function public.finance_receive_amazon_income(uuid,uuid,numeric,timestamptz,text,text) to authenticated,service_role;

commit;
