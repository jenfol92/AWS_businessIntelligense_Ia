-- Alertas persistidas (stock, docs, pagos, etc.)
-- En v1 persistimos alertas "stock" por producto + pais.

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  severidad text not null check (severidad in ('low','medium','high')),
  producto_id uuid null,
  pais text null,
  mensaje text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','closed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedupe lógico (v1): una alerta por tipo + producto + país.
-- Esto permite usar upsert con onConflict: "tipo,producto_id,pais".
alter table public.alerts
  add constraint alerts_tipo_producto_pais_unique unique (tipo, producto_id, pais);

-- Si en el pasado creaste el índice parcial, puedes borrarlo (opcional):
-- drop index if exists public.alerts_stock_producto_pais_unique;

-- Nota RLS:
-- Si tienes RLS activado en tu proyecto, necesitarás políticas para ver/insertar alertas.
-- En MVP, puedes dejar RLS desactivado en public.alerts o añadir policies para usuarios autenticados.

