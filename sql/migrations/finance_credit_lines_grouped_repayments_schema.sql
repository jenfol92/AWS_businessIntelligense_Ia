-- FASE FINANCE-CREDIT-LINES-GROUPS-SCHEMA-1
-- Estructura para vencimientos agrupados, movimientos de caja y financiacion real.
-- Solo schema: no crea servicios, endpoints, UI ni recalcula historicos.

create table if not exists public.finance_cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.finance_cash_accounts(id) on delete cascade,
  movement_type text not null,
  direction text not null,
  amount numeric not null,
  source_type text null,
  source_id uuid null,
  movement_date date not null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_cash_movements_amount_check check (amount > 0),
  constraint finance_cash_movements_direction_check check (direction in ('in', 'out')),
  constraint finance_cash_movements_type_check check (
    movement_type in ('supplier_payment', 'credit_repayment', 'income', 'fee', 'adjustment')
  )
);

create index if not exists idx_finance_cash_movements_account
  on public.finance_cash_movements(cash_account_id);

create index if not exists idx_finance_cash_movements_date
  on public.finance_cash_movements(movement_date);

create index if not exists idx_finance_cash_movements_source
  on public.finance_cash_movements(source_type, source_id);

create index if not exists idx_finance_cash_movements_type
  on public.finance_cash_movements(movement_type);

create table if not exists public.finance_credit_line_repayment_groups (
  id uuid primary key default gen_random_uuid(),
  credit_line_id uuid not null references public.finance_credit_lines(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  due_date date not null,
  amount numeric not null default 0,
  paid_amount numeric not null default 0,
  remaining_amount numeric not null default 0,
  status text not null default 'open',
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_credit_line_repayment_groups_amount_check check (amount >= 0),
  constraint finance_credit_line_repayment_groups_paid_amount_check check (paid_amount >= 0),
  constraint finance_credit_line_repayment_groups_remaining_amount_check check (remaining_amount >= 0),
  constraint finance_credit_line_repayment_groups_status_check check (
    status in ('open', 'partially_paid', 'paid', 'cancelled')
  ),
  constraint finance_credit_line_repayment_groups_period_check check (period_end >= period_start),
  constraint finance_credit_line_repayment_groups_due_date_check check (due_date >= period_start)
);

create index if not exists idx_finance_credit_line_repayment_groups_line
  on public.finance_credit_line_repayment_groups(credit_line_id);

create index if not exists idx_finance_credit_line_repayment_groups_due_date
  on public.finance_credit_line_repayment_groups(due_date);

create index if not exists idx_finance_credit_line_repayment_groups_status
  on public.finance_credit_line_repayment_groups(status);

create unique index if not exists ux_finance_credit_line_repayment_groups_active_period
  on public.finance_credit_line_repayment_groups(credit_line_id, period_start, period_end)
  where status <> 'cancelled';

alter table public.finance_credit_line_movements
  add column if not exists movement_date date null;

alter table public.finance_credit_line_movements
  add column if not exists repayment_group_id uuid null;

alter table public.finance_credit_line_movements
  add column if not exists idempotency_key text null;

alter table public.finance_credit_line_movements
  add column if not exists cash_movement_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_credit_line_movements_repayment_group_fkey'
  ) then
    alter table public.finance_credit_line_movements
      add constraint finance_credit_line_movements_repayment_group_fkey
      foreign key (repayment_group_id)
      references public.finance_credit_line_repayment_groups(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_credit_line_movements_cash_movement_fkey'
  ) then
    alter table public.finance_credit_line_movements
      add constraint finance_credit_line_movements_cash_movement_fkey
      foreign key (cash_movement_id)
      references public.finance_cash_movements(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_finance_credit_line_movements_repayment_group
  on public.finance_credit_line_movements(repayment_group_id);

create index if not exists idx_finance_credit_line_movements_source
  on public.finance_credit_line_movements(source_type, source_id);

create index if not exists idx_finance_credit_line_movements_type
  on public.finance_credit_line_movements(movement_type);

create index if not exists idx_finance_credit_line_movements_movement_date
  on public.finance_credit_line_movements(movement_date);

create unique index if not exists ux_finance_credit_line_movements_source_idempotent
  on public.finance_credit_line_movements(credit_line_id, movement_type, source_type, source_id)
  where source_type is not null and source_id is not null;

create unique index if not exists ux_finance_credit_line_movements_idempotency_key
  on public.finance_credit_line_movements(idempotency_key)
  where idempotency_key is not null;

alter table public.finance_supplier_payments
  add column if not exists payment_source_type text null;

alter table public.finance_supplier_payments
  add column if not exists cash_account_id uuid null;

alter table public.finance_supplier_payments
  add column if not exists credit_line_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_supplier_payments_cash_account_fkey'
  ) then
    alter table public.finance_supplier_payments
      add constraint finance_supplier_payments_cash_account_fkey
      foreign key (cash_account_id)
      references public.finance_cash_accounts(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_supplier_payments_credit_line_fkey'
  ) then
    alter table public.finance_supplier_payments
      add constraint finance_supplier_payments_credit_line_fkey
      foreign key (credit_line_id)
      references public.finance_credit_lines(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_supplier_payments_source_type_check'
  ) then
    alter table public.finance_supplier_payments
      add constraint finance_supplier_payments_source_type_check
      check (
        payment_source_type is null
        or payment_source_type in ('cash_account', 'credit_line', 'manual')
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'finance_supplier_payments_source_target_check'
  ) then
    alter table public.finance_supplier_payments
      add constraint finance_supplier_payments_source_target_check
      check (
        payment_source_type is null
        or (payment_source_type = 'cash_account' and cash_account_id is not null)
        or (payment_source_type = 'credit_line' and credit_line_id is not null)
        or payment_source_type = 'manual'
      );
  end if;
end $$;

create index if not exists idx_finance_supplier_payments_source_type
  on public.finance_supplier_payments(payment_source_type);

create index if not exists idx_finance_supplier_payments_cash_account
  on public.finance_supplier_payments(cash_account_id);

create index if not exists idx_finance_supplier_payments_credit_line
  on public.finance_supplier_payments(credit_line_id);

comment on table public.finance_credit_line_repayment_groups is
  'Vencimientos agrupados por linea de credito y periodo de consumo.';

comment on table public.finance_cash_movements is
  'Ledger de movimientos de caja/cuenta para pagos, devoluciones, ingresos y ajustes.';

comment on column public.finance_credit_line_movements.repayment_group_id is
  'Grupo de vencimiento al que pertenece el movimiento de linea, si aplica.';

comment on column public.finance_credit_line_movements.movement_date is
  'Fecha efectiva del movimiento financiero.';

comment on column public.finance_credit_line_movements.idempotency_key is
  'Clave opcional para evitar duplicados por reintentos.';

comment on column public.finance_credit_line_movements.cash_movement_id is
  'Movimiento de caja asociado, si el movimiento de linea mueve caja.';

comment on column public.finance_supplier_payments.payment_source_type is
  'Fuente real del pago: cash_account, credit_line o manual. payment_source queda como etiqueta legacy.';

comment on column public.finance_supplier_payments.cash_account_id is
  'Cuenta/caja real usada para pagar proveedor, si aplica.';

comment on column public.finance_supplier_payments.credit_line_id is
  'Linea de credito real usada para financiar el pago proveedor, si aplica.';
