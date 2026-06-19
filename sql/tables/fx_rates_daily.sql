-- Tipos de cambio diarios (cache)
-- Guardamos rates en formato: 1 {base} = rate {quote}
-- Ej: base='EUR', quote='USD', rate=1.08

create table if not exists public.fx_rates_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  base text not null,
  quote text not null,
  rate numeric not null,
  source text null,
  created_at timestamptz not null default now(),
  unique (date, base, quote)
);

