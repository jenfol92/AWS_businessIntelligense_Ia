-- DEFERRED treasury observations: persist Amazon release metadata separately from ERP payout dates.
-- Atomically replaces legacy RPC overloads (24/28 args) with a single canonical 32-arg function.
-- Does not receive cash, create movements, or backfill historical rows.
begin;

alter table public.finance_amazon_treasury_forecast_snapshots
  add column if not exists amazon_transaction_type text,
  add column if not exists amazon_posted_at timestamptz,
  add column if not exists amazon_release_date date,
  add column if not exists amazon_deferral_reason text;

comment on column public.finance_amazon_treasury_forecast_snapshots.amazon_transaction_type is
  'Amazon listTransactions.transactionType when observed (e.g. Shipment, Refund); open string, not an ERP enum.';
comment on column public.finance_amazon_treasury_forecast_snapshots.amazon_posted_at is
  'Amazon listTransactions.postedDate for the transaction.';
comment on column public.finance_amazon_treasury_forecast_snapshots.amazon_release_date is
  'UTC calendar day from Amazon DeferredContext.maturityDate: expected Amazon transaction release day, not bank receipt and not time-of-day.';
comment on column public.finance_amazon_treasury_forecast_snapshots.amazon_deferral_reason is
  'Amazon DeferredContext.deferralReason (e.g. DD7, B2B); open string, not an ERP enum.';

-- Legacy overloads from 20260812_01 (24 args) and 20260812_02 (28 args).
-- Signatures taken from pg_get_function_identity_arguments on deployed production (oids 53879, 54403).
drop function if exists public.finance_insert_amazon_treasury_observation(
  p_observation_key text, p_source_key text, p_marketplace text, p_economic_state text, p_observed_at timestamp with time zone, p_original_currency text, p_original_amount numeric, p_amount_eur numeric, p_official_amount_eur numeric, p_financial_event_group_id text, p_amazon_transaction_id text, p_transaction_status text, p_settlement_processing_status text, p_fund_transfer_status text, p_fund_transfer_at timestamp with time zone, p_expected_availability_date date, p_expected_request_date date, p_expected_bank_date date, p_confidence text, p_estimation_method text, p_fx_source text, p_fx_observed_at timestamp with time zone, p_source text, p_evidence jsonb
);
drop function if exists public.finance_insert_amazon_treasury_observation(
  p_observation_key text, p_source_key text, p_marketplace text, p_economic_state text, p_observed_at timestamp with time zone, p_original_currency text, p_original_amount numeric, p_amount_eur numeric, p_official_amount_eur numeric, p_financial_event_group_id text, p_amazon_transaction_id text, p_transaction_status text, p_settlement_processing_status text, p_fund_transfer_status text, p_fund_transfer_at timestamp with time zone, p_expected_availability_date date, p_expected_request_date date, p_expected_bank_date date, p_confidence text, p_estimation_method text, p_fx_source text, p_fx_observed_at timestamp with time zone, p_fx_kind text, p_estimated_fx_rate numeric, p_realized_fx_rate numeric, p_realized_amount_eur numeric, p_source text, p_evidence jsonb
);

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
begin
  if p_economic_state not in ('DEFERRED','AVAILABLE','PENDING_BANK') then
    raise exception 'OBSERVATIONAL_SNAPSHOT_CANNOT_CREATE_RECEIVED';
  end if;
  if p_fx_kind not in ('AMAZON_REALIZED_FX','ERP_ESTIMATED_FX','UNAVAILABLE') then
    raise exception 'INVALID_AMAZON_FX_KIND';
  end if;
  insert into public.finance_amazon_treasury_forecast_snapshots(
    forecast_id,observation_key,source_key,marketplace,economic_state,snapshot_at,original_currency,original_amount,
    amount_eur,official_amount_eur,estimated_amount_eur,estimated_fx_rate,realized_amount_eur,realized_fx_rate,fx_kind,
    financial_event_group_id,amazon_transaction_id,transaction_status,settlement_processing_status,fund_transfer_status,
    fund_transfer_at,expected_availability_date,expected_request_date,expected_bank_date,confidence,estimation_method,
    fx_source,fx_observed_at,amazon_transaction_type,amazon_posted_at,amazon_release_date,amazon_deferral_reason,
    source,evidence
  ) values (
    null,p_observation_key,p_source_key,p_marketplace,p_economic_state,p_observed_at,p_original_currency,round(p_original_amount,2),
    round(p_amount_eur,2),round(p_official_amount_eur,2),case when p_fx_kind='ERP_ESTIMATED_FX' then round(p_amount_eur,2) end,
    p_estimated_fx_rate,round(p_realized_amount_eur,2),p_realized_fx_rate,p_fx_kind,p_financial_event_group_id,
    p_amazon_transaction_id,p_transaction_status,p_settlement_processing_status,p_fund_transfer_status,p_fund_transfer_at,
    p_expected_availability_date,p_expected_request_date,p_expected_bank_date,p_confidence,p_estimation_method,p_fx_source,
    p_fx_observed_at,nullif(btrim(p_amazon_transaction_type),''),p_amazon_posted_at,p_amazon_release_date,
    nullif(btrim(p_amazon_deferral_reason),''),coalesce(nullif(btrim(p_source),''),'amazon_sp_api'),coalesce(p_evidence,'{}'::jsonb)
  )
  on conflict (observation_key) where observation_key is not null
  do update set
    evidence=excluded.evidence,
    amazon_transaction_type=coalesce(excluded.amazon_transaction_type, finance_amazon_treasury_forecast_snapshots.amazon_transaction_type),
    amazon_posted_at=coalesce(excluded.amazon_posted_at, finance_amazon_treasury_forecast_snapshots.amazon_posted_at),
    amazon_release_date=coalesce(excluded.amazon_release_date, finance_amazon_treasury_forecast_snapshots.amazon_release_date),
    amazon_deferral_reason=coalesce(excluded.amazon_deferral_reason, finance_amazon_treasury_forecast_snapshots.amazon_deferral_reason)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.finance_insert_amazon_treasury_observation(
  text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,date,date,date,text,text,text,timestamptz,text,numeric,numeric,numeric,text,timestamptz,date,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.finance_insert_amazon_treasury_observation(
  text,text,text,text,timestamptz,text,numeric,numeric,numeric,text,text,text,text,text,timestamptz,date,date,date,text,text,text,timestamptz,text,numeric,numeric,numeric,text,timestamptz,date,text,text,jsonb
) to service_role;

commit;
