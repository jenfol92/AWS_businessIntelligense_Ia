-- Selección de competidores para forecast (decisión de negocio).
-- Histórico puro en competitor_benchmark_snapshots; no mezclar flags aquí.

create table if not exists public.product_competitor_benchmark_selection (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  marketplace_country text not null,
  competitor_asin text not null,
  competitor_title text null,
  is_selected boolean not null default true,
  use_for_forecast boolean not null default true,
  weight numeric null,
  capture_pct numeric null,
  snapshot_id uuid null references public.competitor_benchmark_snapshots(id) on delete set null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_competitor_benchmark_selection_unique
    unique (producto_id, marketplace_country, competitor_asin)
);

create index if not exists idx_pcb_selection_producto_id
  on public.product_competitor_benchmark_selection (producto_id);

create index if not exists idx_pcb_selection_marketplace_country
  on public.product_competitor_benchmark_selection (marketplace_country);

create index if not exists idx_pcb_selection_use_for_forecast
  on public.product_competitor_benchmark_selection (use_for_forecast)
  where use_for_forecast = true;

create index if not exists idx_pcb_selection_competitor_asin
  on public.product_competitor_benchmark_selection (competitor_asin);

comment on table public.product_competitor_benchmark_selection is
  'Competidores elegidos por producto/marketplace para forecast. Separado del histórico en competitor_benchmark_snapshots.';
