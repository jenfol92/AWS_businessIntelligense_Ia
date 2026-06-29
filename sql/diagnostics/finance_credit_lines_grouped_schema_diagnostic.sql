-- Diagnostico: estructura para vencimientos agrupados, movimientos de caja y financiacion real.
-- Ejecutar en Supabase SQL Editor despues de aplicar la migracion.

-- 1) Tablas requeridas
select
  expected.table_name,
  case when t.table_name is not null then 'ok' else 'missing' end as status
from (
  values
    ('finance_credit_line_repayment_groups'),
    ('finance_cash_movements')
) as expected(table_name)
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = expected.table_name
order by expected.table_name;

-- 2) Columnas requeridas
select
  expected.table_name,
  expected.column_name,
  case when c.column_name is not null then 'ok' else 'missing' end as status,
  c.data_type
from (
  values
    ('finance_credit_line_movements', 'repayment_group_id'),
    ('finance_credit_line_movements', 'movement_date'),
    ('finance_credit_line_movements', 'idempotency_key'),
    ('finance_credit_line_movements', 'cash_movement_id'),
    ('finance_supplier_payments', 'payment_source_type'),
    ('finance_supplier_payments', 'cash_account_id'),
    ('finance_supplier_payments', 'credit_line_id')
) as expected(table_name, column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = expected.table_name
 and c.column_name = expected.column_name
order by expected.table_name, expected.column_name;

-- 3) Constraints principales
select
  conrelid::regclass as table_name,
  conname,
  contype,
  pg_get_constraintdef(oid) as constraint_def
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid in (
    'public.finance_credit_line_repayment_groups'::regclass,
    'public.finance_cash_movements'::regclass,
    'public.finance_credit_line_movements'::regclass,
    'public.finance_supplier_payments'::regclass
  )
  and conname in (
    'finance_credit_line_repayment_groups_amount_check',
    'finance_credit_line_repayment_groups_paid_amount_check',
    'finance_credit_line_repayment_groups_remaining_amount_check',
    'finance_credit_line_repayment_groups_status_check',
    'finance_credit_line_repayment_groups_period_check',
    'finance_credit_line_repayment_groups_due_date_check',
    'finance_cash_movements_amount_check',
    'finance_cash_movements_direction_check',
    'finance_cash_movements_type_check',
    'finance_credit_line_movements_repayment_group_fkey',
    'finance_credit_line_movements_cash_movement_fkey',
    'finance_supplier_payments_cash_account_fkey',
    'finance_supplier_payments_credit_line_fkey',
    'finance_supplier_payments_source_type_check',
    'finance_supplier_payments_source_target_check'
  )
order by conrelid::regclass::text, conname;

-- 4) Indices de agrupacion e idempotencia
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'ux_finance_credit_line_repayment_groups_active_period',
    'ux_finance_credit_line_movements_source_idempotent',
    'ux_finance_credit_line_movements_idempotency_key',
    'idx_finance_credit_line_movements_repayment_group',
    'idx_finance_cash_movements_source'
  )
order by tablename, indexname;
