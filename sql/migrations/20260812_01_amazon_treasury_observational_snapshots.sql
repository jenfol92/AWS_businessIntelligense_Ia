-- Observational Amazon Treasury snapshots. This migration does not receive cash,
-- update cash accounts, or create finance_cash_movements.
alter table public.finance_amazon_treasury_forecast_snapshots
  alter column forecast_id drop not null,
  add column if not exists observation_key text,
  add column if not exists financial_event_group_id text,
  add column if not exists amazon_transaction_id text,
  add column if not exists transaction_status text,
  add column if not exists settlement_processing_status text,
  add column if not exists fund_transfer_status text,
  add column if not exists fund_transfer_at timestamptz,
  add column if not exists amount_eur numeric(14,2),
  add column if not exists fx_source text,
  add column if not exists fx_observed_at timestamptz,
  add column if not exists source text not null default 'amazon_sp_api',
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create unique index if not exists ux_amazon_treasury_snapshot_observation_key
  on public.finance_amazon_treasury_forecast_snapshots(observation_key)
  where observation_key is not null;

comment on column public.finance_amazon_treasury_forecast_snapshots.observation_key is
  'Stable idempotency key for one observed identity/state/timestamp bucket.';
comment on column public.finance_amazon_treasury_forecast_snapshots.evidence is
  'Sanitized source evidence only; never proof of bank receipt by itself.';

create or replace function public.finance_insert_amazon_treasury_observation(
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
  p_source text,
  p_evidence jsonb
)
returns public.finance_amazon_treasury_forecast_snapshots
language plpgsql
security definer
set search_path=public
as $$
declare v_row public.finance_amazon_treasury_forecast_snapshots;
begin
  if p_economic_state not in ('DEFERRED','AVAILABLE','PENDING_BANK','RECEIVED') then
    raise exception 'UNSUPPORTED_AMAZON_ECONOMIC_STATE';
  end if;
  if p_economic_state='RECEIVED' then
    raise exception 'OBSERVATIONAL_SNAPSHOT_CANNOT_CREATE_RECEIVED';
  end if;
  insert into public.finance_amazon_treasury_forecast_snapshots(
    forecast_id,observation_key,source_key,marketplace,economic_state,snapshot_at,
    original_currency,original_amount,amount_eur,official_amount_eur,
    financial_event_group_id,amazon_transaction_id,transaction_status,
    settlement_processing_status,fund_transfer_status,fund_transfer_at,
    expected_availability_date,expected_request_date,expected_bank_date,
    confidence,estimation_method,fx_source,fx_observed_at,source,evidence
  ) values (
    null,p_observation_key,p_source_key,p_marketplace,p_economic_state,p_observed_at,
    p_original_currency,round(p_original_amount,2),round(p_amount_eur,2),round(p_official_amount_eur,2),
    p_financial_event_group_id,p_amazon_transaction_id,p_transaction_status,
    p_settlement_processing_status,p_fund_transfer_status,p_fund_transfer_at,
    p_expected_availability_date,p_expected_request_date,p_expected_bank_date,
    p_confidence,p_estimation_method,p_fx_source,p_fx_observed_at,
    coalesce(nullif(btrim(p_source),''),'amazon_sp_api'),coalesce(p_evidence,'{}'::jsonb)
  )
  on conflict (observation_key) where observation_key is not null
  do update set evidence=excluded.evidence
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.finance_insert_amazon_treasury_observation(
  text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,
  timestamptz,date,date,date,text,text,text,timestamptz,text,jsonb
) from public,anon,authenticated;
grant execute on function public.finance_insert_amazon_treasury_observation(
  text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,
  timestamptz,date,date,date,text,text,text,timestamptz,text,jsonb
) to service_role;
