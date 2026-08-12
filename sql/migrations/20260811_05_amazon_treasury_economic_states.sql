-- Structural-only migration. It deliberately does not reclassify existing rows.
alter table public.finance_amazon_income_forecasts
  add column if not exists economic_state text,
  add column if not exists amazon_transaction_id text,
  add column if not exists transaction_status text,
  add column if not exists snapshot_at timestamptz,
  add column if not exists first_seen_deferred_at timestamptz,
  add column if not exists released_observed_at timestamptz,
  add column if not exists availability_date date,
  add column if not exists expected_bank_date date,
  add column if not exists date_is_estimated boolean not null default false,
  add column if not exists confidence text,
  add column if not exists estimation_method text,
  add column if not exists original_currency text,
  add column if not exists original_amount numeric(14,2),
  add column if not exists treasury_amount_eur numeric(14,2),
  add column if not exists official_converted_amount_eur numeric(14,2);

alter table public.finance_amazon_income_forecasts
  drop constraint if exists finance_amazon_income_economic_state_check;
alter table public.finance_amazon_income_forecasts
  add constraint finance_amazon_income_economic_state_check
  check (economic_state is null or economic_state in
    ('RECEIVED','PENDING_BANK','AVAILABLE','DEFERRED','FUTURE'));

alter table public.finance_amazon_income_forecasts
  drop constraint if exists finance_amazon_income_transaction_status_check;
alter table public.finance_amazon_income_forecasts
  add constraint finance_amazon_income_transaction_status_check
  check (transaction_status is null or transaction_status in
    ('DEFERRED','DEFERRED_RELEASED','RELEASED'));

alter table public.finance_amazon_income_forecasts
  drop constraint if exists finance_amazon_income_confidence_check;
alter table public.finance_amazon_income_forecasts
  add constraint finance_amazon_income_confidence_check
  check (confidence is null or confidence in ('exact','high','medium','low','unavailable'));

create unique index if not exists finance_amazon_income_forecasts_transaction_id_uq
  on public.finance_amazon_income_forecasts(amazon_transaction_id)
  where amazon_transaction_id is not null;

insert into public.finance_settings(key,value)
values
  ('amazon_transfer_request_weekdays','[1,3]'),
  ('amazon_bank_lag_days','2'),
  ('amazon_treasury_percentile','0.75'),
  ('amazon_min_history_samples','100')
on conflict (key) do nothing;

create or replace function public.finance_upsert_amazon_treasury_item(
  p_source_key text,
  p_economic_state text,
  p_marketplace text,
  p_original_currency text,
  p_original_amount numeric,
  p_amount_eur numeric,
  p_amazon_transaction_id text default null,
  p_transaction_status text default null,
  p_snapshot_at timestamptz default now(),
  p_availability_date date default null,
  p_expected_bank_date date default null,
  p_date_is_estimated boolean default false,
  p_confidence text default null,
  p_estimation_method text default null,
  p_official_converted_amount_eur numeric default null,
  p_settlement_id text default null,
  p_fund_transfer_status text default null,
  p_fund_transfer_at timestamptz default null
) returns public.finance_amazon_income_forecasts
language plpgsql security definer set search_path=public as $$
declare
  v_state text:=upper(btrim(coalesce(p_economic_state,'')));
  v_source text:=nullif(btrim(p_source_key),'');
  v_tx text:=nullif(btrim(p_amazon_transaction_id),'');
  v_row public.finance_amazon_income_forecasts%rowtype;
begin
  if v_state not in ('PENDING_BANK','AVAILABLE','DEFERRED') then
    raise exception 'INVALID_AUTOMATED_AMAZON_TREASURY_STATE';
  end if;
  if v_source is null or nullif(btrim(p_marketplace),'') is null
     or nullif(btrim(p_original_currency),'') is null
     or p_original_amount is null then
    raise exception 'AMAZON_TREASURY_REQUIRED_FIELDS';
  end if;
  if v_state='DEFERRED' and v_tx is null then
    raise exception 'AMAZON_TRANSACTION_ID_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('amazon-treasury:'||coalesce(v_tx,v_source),0));
  select * into v_row from public.finance_amazon_income_forecasts
   where (v_tx is not null and amazon_transaction_id=v_tx) or source_key=v_source
   order by (amazon_transaction_id=v_tx) desc limit 1 for update;

  if found and coalesce(v_row.economic_state,'') in ('RECEIVED','PENDING_BANK')
     and v_state in ('AVAILABLE','DEFERRED') then
    return v_row;
  end if;

  if found then
    update public.finance_amazon_income_forecasts set
      economic_state=v_state,
      marketplace=upper(btrim(p_marketplace)),
      original_currency=upper(btrim(p_original_currency)),
      original_amount=round(p_original_amount,2),
      treasury_amount_eur=case when p_amount_eur is null then null else round(p_amount_eur,2) end,
      official_converted_amount_eur=case when p_official_converted_amount_eur is null then null else round(p_official_converted_amount_eur,2) end,
      amazon_transaction_id=coalesce(amazon_transaction_id,v_tx),
      transaction_status=p_transaction_status,
      snapshot_at=p_snapshot_at,
      first_seen_deferred_at=case when v_state='DEFERRED' then coalesce(first_seen_deferred_at,p_snapshot_at) else first_seen_deferred_at end,
      availability_date=p_availability_date,
      expected_bank_date=p_expected_bank_date,
      date_is_estimated=p_date_is_estimated,
      confidence=p_confidence,
      estimation_method=p_estimation_method,
      settlement_id=coalesce(settlement_id,nullif(btrim(p_settlement_id),'')),
      fund_transfer_status=coalesce(nullif(btrim(p_fund_transfer_status),''),fund_transfer_status),
      fund_transfer_at=coalesce(p_fund_transfer_at,fund_transfer_at),
      updated_at=now()
    where id=v_row.id returning * into v_row;
  else
    insert into public.finance_amazon_income_forecasts(
      source_key,forecast_date,description,amount_eur,status,marketplace,economic_state,
      amazon_transaction_id,transaction_status,snapshot_at,first_seen_deferred_at,
      availability_date,expected_bank_date,date_is_estimated,confidence,estimation_method,
      original_currency,original_amount,treasury_amount_eur,official_converted_amount_eur,settlement_id,
      fund_transfer_status,fund_transfer_at,updated_at)
    values(
      v_source,coalesce(p_expected_bank_date,p_availability_date,p_snapshot_at::date),
      'Amazon '||lower(v_state)||' '||upper(btrim(p_marketplace)),
      case when p_amount_eur is null then 0 else round(p_amount_eur,2) end,
      'projected',upper(btrim(p_marketplace)),v_state,v_tx,p_transaction_status,p_snapshot_at,
      case when v_state='DEFERRED' then p_snapshot_at else null end,
      p_availability_date,p_expected_bank_date,p_date_is_estimated,p_confidence,p_estimation_method,
      upper(btrim(p_original_currency)),round(p_original_amount,2),
      case when p_amount_eur is null then null else round(p_amount_eur,2) end,
      case when p_official_converted_amount_eur is null then null else round(p_official_converted_amount_eur,2) end,
      nullif(btrim(p_settlement_id),''),nullif(btrim(p_fund_transfer_status),''),p_fund_transfer_at,now())
    returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function public.finance_observe_amazon_deferred_release(
  p_amazon_transaction_id text,
  p_observed_at timestamptz default now()
) returns public.finance_amazon_income_forecasts
language plpgsql security definer set search_path=public as $$
declare v_row public.finance_amazon_income_forecasts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('amazon-transaction:'||btrim(p_amazon_transaction_id),0));
  update public.finance_amazon_income_forecasts set
    transaction_status='DEFERRED_RELEASED',
    released_observed_at=coalesce(released_observed_at,p_observed_at),
    -- AVAILABLE is represented once by the current Open group total, never by
    -- each released transaction as well.
    economic_state=case when economic_state='DEFERRED' then null else economic_state end,
    treasury_amount_eur=case when economic_state='DEFERRED' then null else treasury_amount_eur end,
    expected_bank_date=case when economic_state='DEFERRED' then null else expected_bank_date end,
    updated_at=now()
  where amazon_transaction_id=btrim(p_amazon_transaction_id)
    and coalesce(economic_state,'') not in ('PENDING_BANK','RECEIVED')
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.finance_upsert_amazon_treasury_item(text,text,text,text,numeric,numeric,text,text,timestamptz,date,date,boolean,text,text,numeric,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.finance_observe_amazon_deferred_release(text,timestamptz) from public,anon,authenticated;
grant execute on function public.finance_upsert_amazon_treasury_item(text,text,text,text,numeric,numeric,text,text,timestamptz,date,date,boolean,text,text,numeric,text,text,timestamptz) to service_role;
grant execute on function public.finance_observe_amazon_deferred_release(text,timestamptz) to service_role;
