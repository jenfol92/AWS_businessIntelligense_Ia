select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'finance_credit_lines',
    'finance_cash_accounts',
    'finance_credit_line_repayment_groups'
  )
order by tablename;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'finance_credit_lines',
    'finance_cash_accounts',
    'finance_credit_line_repayment_groups'
  )
order by tablename, policyname;
