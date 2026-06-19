-- Pagos proveedor por orden (deposito 30 % y balance 70 %).
-- Idempotencia: una fila por (orden_id, payment_type).
-- FASE 1: no mezclar con movimientos/vencimientos de lineas bancarias.

create table if not exists public.finance_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_compra(id) on delete cascade,
  payment_type text not null check (payment_type in ('DEPOSITO_30', 'BALANCE_70')),
  due_date date,
  paid_at timestamptz,
  amount numeric(14, 4),
  currency text not null default 'USD',
  amount_original numeric(14, 4),
  original_currency text not null default 'USD',
  planned_fx_rate numeric(12, 6),
  amount_eur numeric(14, 4) not null default 0,
  logistics_type text,
  contenedor_id uuid references public.contenedores(id) on delete set null,
  source_type text,
  source_id uuid,
  payment_source text,
  status text not null default 'pendiente' check (status in ('pendiente', 'pagado', 'vencido')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_finance_supplier_payments_orden_type
  on public.finance_supplier_payments(orden_id, payment_type);

create index if not exists idx_finance_supplier_payments_due_date
  on public.finance_supplier_payments(due_date);

comment on table public.finance_supplier_payments is
  'Pagos proveedor por orden confirmada. No duplicar al crear contenedor.';
