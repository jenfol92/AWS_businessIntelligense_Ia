-- Alineacion incremental FASE 1 para finance_supplier_payments.
-- Usar si la tabla ya existia de ejecuciones previas (sin amount/currency/source_*).
-- RLS: aplicar aparte sql/migrations/finance_supplier_payments_rls.sql

alter table if exists public.finance_supplier_payments
  add column if not exists due_date date,
  add column if not exists paid_at timestamptz,
  add column if not exists amount numeric(14, 4),
  add column if not exists currency text not null default 'USD',
  add column if not exists amount_original numeric(14, 4),
  add column if not exists original_currency text not null default 'USD',
  add column if not exists planned_fx_rate numeric(12, 6),
  add column if not exists amount_eur numeric(14, 4) not null default 0,
  add column if not exists actual_amount_original numeric(14, 4),
  add column if not exists actual_amount_eur numeric(14, 2),
  add column if not exists bank_fee_eur numeric(14, 2),
  add column if not exists ff_fee_eur numeric(14, 2),
  add column if not exists logistics_type text,
  add column if not exists contenedor_id uuid references public.contenedores(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists payment_source text,
  add column if not exists status text not null default 'pendiente',
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.finance_supplier_payments
  drop constraint if exists finance_supplier_payments_payment_type_check;

alter table if exists public.finance_supplier_payments
  add constraint finance_supplier_payments_payment_type_check
  check (payment_type in ('DEPOSITO_30', 'BALANCE_70'));

alter table if exists public.finance_supplier_payments
  drop constraint if exists finance_supplier_payments_status_check;

alter table if exists public.finance_supplier_payments
  add constraint finance_supplier_payments_status_check
  check (status in ('pendiente', 'pagado', 'vencido'));

create unique index if not exists ux_finance_supplier_payments_orden_type
  on public.finance_supplier_payments(orden_id, payment_type);

create index if not exists idx_finance_supplier_payments_due_date
  on public.finance_supplier_payments(due_date);

drop index if exists public.ux_finance_credit_line_movements_source;

-- Normalizar valores de logistics_type al formato canónico.
-- Convierte etiquetas legado ('AGL', 'PROPIO', 'SIN_DEFINIR') al formato canónico
-- ('amazon_agl', 'propio', 'sin_definir') que usa el código TypeScript a partir de FASE 1.
update public.finance_supplier_payments
set logistics_type = 'amazon_agl'
where logistics_type = 'AGL';

update public.finance_supplier_payments
set logistics_type = 'propio'
where logistics_type = 'PROPIO';

update public.finance_supplier_payments
set logistics_type = 'sin_definir'
where logistics_type = 'SIN_DEFINIR';
