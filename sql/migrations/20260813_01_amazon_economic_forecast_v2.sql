begin;

create table if not exists public.finance_amazon_economic_forecast_v2 (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  marketplace text not null,
  month date not null,
  as_of_date date not null,
  model_version text not null,
  currency text not null,
  real_net_mtd numeric(16,2) not null,
  real_net_mtd_eur numeric(16,2),
  future_gross numeric(16,2) not null default 0,
  future_known_fees numeric(16,2) not null default 0,
  future_known_storage numeric(16,2) not null default 0,
  future_net_known numeric(16,2) not null default 0,
  expected_month_net numeric(16,2) not null,
  expected_month_net_eur numeric(16,2),
  confidence text not null check (confidence in ('high','medium','low')),
  gaps jsonb not null default '[]'::jsonb,
  source_timestamps jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (source_key like 'forecast-v2:%'),
  check (date_trunc('month',month)::date=month),
  check (jsonb_typeof(gaps)='array')
);

create table if not exists public.finance_amazon_economic_forecast_v2_details (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references public.finance_amazon_economic_forecast_v2(id) on delete cascade,
  product_id uuid references public.productos(id) on delete set null,
  sku text not null,
  asin text,
  marketplace text not null,
  fulfillment_channel text not null check (fulfillment_channel in ('FBA','FBM')),
  units_mtd numeric(16,4) not null default 0,
  rate_7d numeric(16,6) not null default 0,
  rate_14d numeric(16,6) not null default 0,
  rate_30d numeric(16,6) not null default 0,
  weighted_rate numeric(16,6) not null default 0,
  remaining_days integer not null check (remaining_days between 0 and 31),
  forecast_units numeric(16,4) not null default 0,
  stock_value numeric(16,4),
  stock_freshness text not null check (stock_freshness in ('FRESH','STALE','UNAVAILABLE')),
  price_used numeric(16,4) not null,
  price_source text not null check (price_source in ('REALIZED_MTD','REALIZED_30D','CURRENT_LISTING','TARGET_FALLBACK')),
  referral_fee_per_unit numeric(16,4) not null default 0,
  fulfillment_fee_per_unit numeric(16,4) not null default 0,
  fee_source text not null check (fee_source in ('PRODUCT_FEES_API','FBA_FEE_PREVIEW_REPORT','UNAVAILABLE')),
  gross_future numeric(16,2) not null default 0,
  net_future numeric(16,2) not null default 0,
  currency text not null,
  amount_eur numeric(16,2),
  fx_source text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  gaps jsonb not null default '[]'::jsonb,
  source_timestamps jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(forecast_id,marketplace,sku,fulfillment_channel),
  check (jsonb_typeof(gaps)='array')
);

create index if not exists finance_amazon_economic_forecast_v2_month_idx on public.finance_amazon_economic_forecast_v2(month,marketplace,as_of_date desc);
create index if not exists finance_amazon_economic_forecast_v2_details_forecast_idx on public.finance_amazon_economic_forecast_v2_details(forecast_id,marketplace,sku);

alter table public.finance_amazon_economic_forecast_v2 enable row level security;
alter table public.finance_amazon_economic_forecast_v2_details enable row level security;
revoke all on public.finance_amazon_economic_forecast_v2 from anon,authenticated;
revoke all on public.finance_amazon_economic_forecast_v2_details from anon,authenticated;
grant select,insert,update,delete on public.finance_amazon_economic_forecast_v2 to service_role;
grant select,insert,update,delete on public.finance_amazon_economic_forecast_v2_details to service_role;

commit;

