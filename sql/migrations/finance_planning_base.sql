-- Fase 1 finanzas: tablas base para planificacion financiera.
-- No se anade agente_id a contenedores: el agente se deriva desde la orden vinculada.

create table if not exists public.finance_credit_lines (
  id uuid primary key default uuid_generate_v4(),
  bank_name text not null,
  line_name text not null,
  credit_limit numeric not null default 0,
  available_amount numeric not null default 0,
  used_amount numeric not null default 0,
  cycle_days integer,
  start_date date,
  maturity_date date,
  repayment_mode text not null,
  repayment_amount numeric,
  interest_rate numeric,
  fixed_fee numeric,
  priority integer,
  status text not null default 'activa',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_finance_credit_lines_bank_line
  on public.finance_credit_lines(bank_name, line_name);

create table if not exists public.finance_credit_line_movements (
  id uuid primary key default uuid_generate_v4(),
  credit_line_id uuid not null references public.finance_credit_lines(id) on delete cascade,
  movement_type text not null,
  description text not null,
  due_date date,
  paid_at timestamptz,
  amount numeric not null default 0,
  status text not null default 'pendiente',
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_credit_line_movements_line
  on public.finance_credit_line_movements(credit_line_id);

create index if not exists idx_finance_credit_line_movements_due_date
  on public.finance_credit_line_movements(due_date);

create table if not exists public.finance_cash_accounts (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  balance numeric not null default 0,
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_amazon_income_forecasts (
  id uuid primary key default uuid_generate_v4(),
  forecast_date date not null,
  description text not null default 'Ingreso Amazon previsto',
  amount_eur numeric not null default 0,
  status text not null default 'previsto',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_finance_amazon_income_forecasts_date
  on public.finance_amazon_income_forecasts(forecast_date);

create table if not exists public.finance_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

insert into public.finance_credit_lines
  (bank_name, line_name, credit_limit, used_amount, available_amount, cycle_days, repayment_mode, notes, priority)
values
  ('Caja Rural', 'Credito Global', 600000, 521500, 78500, 120, 'periodic_release', 'Linea inicial detectada en LINEAS TIEMPO REAL.xlsx.', 1),
  ('La Caixa', 'Credito Global', 200000, 135000, 65000, 90, 'periodic_release', 'Linea inicial detectada en LINEAS TIEMPO REAL.xlsx.', 2),
  ('BBVA', 'Lineas Consolidadas', 250000, 85000, 165000, null, 'manual_due_dates', 'BBVA funciona por sublineas/creditos con fecha de pago propuesta.', 3)
on conflict (bank_name, line_name) do update set
  credit_limit = excluded.credit_limit,
  used_amount = excluded.used_amount,
  available_amount = excluded.available_amount,
  cycle_days = excluded.cycle_days,
  repayment_mode = excluded.repayment_mode,
  notes = excluded.notes,
  priority = excluded.priority,
  updated_at = now();

insert into public.finance_cash_accounts (name, currency)
values ('Caja propia / Deposito financiero', 'EUR')
on conflict (name) do nothing;

insert into public.finance_settings (key, value)
values ('planned_usd_eur_rate', null)
on conflict (key) do nothing;

comment on table public.finance_credit_lines is
  'Lineas de credito bancarias para planificacion financiera.';

comment on table public.finance_credit_line_movements is
  'Movimientos de lineas: liberaciones, disposiciones y pagos vinculables a origen.';

comment on table public.finance_cash_accounts is
  'Cuentas de caja propia usadas para saldos proyectados.';

comment on table public.finance_amazon_income_forecasts is
  'Ingresos Amazon previstos configurables manualmente.';

comment on table public.finance_settings is
  'Parametros financieros configurables, como cambio previsto USD/EUR.';
