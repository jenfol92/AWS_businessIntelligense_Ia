-- Diagnostico: RPC transaccionales de ledger de lineas de credito.
-- Ejecutar en Supabase SQL Editor despues de aplicar la migracion.

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'finance_create_credit_line_drawdown',
    'finance_create_credit_line_repayment'
  )
order by p.proname;

select
  expected.function_name,
  case when p.proname is not null then 'ok' else 'missing' end as status
from (
  values
    ('finance_create_credit_line_drawdown'),
    ('finance_create_credit_line_repayment')
) as expected(function_name)
left join pg_proc p
  on p.proname = expected.function_name
 and p.pronamespace = 'public'::regnamespace
order by expected.function_name;
