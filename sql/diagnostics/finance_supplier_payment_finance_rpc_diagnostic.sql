-- Diagnostico: RPC para financiar pagos proveedor.
-- Ejecutar en Supabase SQL Editor despues de aplicar la migracion.

-- 1) Funcion RPC y firma
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finance_finance_supplier_payment';

-- 2) Indice de idempotencia para salidas de caja por pago proveedor
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname = 'ux_finance_cash_movements_supplier_payment_source';

-- 3) Columnas requeridas en finance_supplier_payments
select
  expected.column_name,
  case when c.column_name is not null then 'ok' else 'missing' end as status,
  c.data_type
from (
  values
    ('payment_source_type'),
    ('cash_account_id'),
    ('credit_line_id')
) as expected(column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'finance_supplier_payments'
 and c.column_name = expected.column_name
order by expected.column_name;
