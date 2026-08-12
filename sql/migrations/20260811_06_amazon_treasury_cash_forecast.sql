-- Prospective-only cash forecast metadata. No historical rows are rewritten and
-- no cash movement is created by this migration.
alter table public.finance_amazon_income_forecasts
  add column if not exists expected_availability_date date,
  add column if not exists expected_request_date date;

create table if not exists public.finance_amazon_treasury_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references public.finance_amazon_income_forecasts(id) on delete cascade,
  source_key text not null,
  marketplace text not null,
  economic_state text not null,
  snapshot_at timestamptz not null,
  expected_availability_date date,
  expected_request_date date,
  expected_bank_date date,
  original_currency text,
  original_amount numeric(14,2),
  official_amount_eur numeric(14,2),
  estimated_amount_eur numeric(14,2),
  confidence text not null,
  estimation_method text not null,
  created_at timestamptz not null default now(),
  unique(forecast_id, snapshot_at)
);

alter table public.finance_amazon_treasury_forecast_snapshots enable row level security;
revoke all on table public.finance_amazon_treasury_forecast_snapshots from public, anon, authenticated;
grant select, insert on table public.finance_amazon_treasury_forecast_snapshots to service_role;

comment on table public.finance_amazon_treasury_forecast_snapshots is
  'Prospective Amazon treasury estimates only; never evidence of bank receipt or cash.';
