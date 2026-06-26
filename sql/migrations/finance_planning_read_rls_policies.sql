-- Permite que la planificacion financiera lea lineas de credito.
-- No concede permisos de escritura.
drop policy if exists "finance_credit_lines_select_authenticated"
on public.finance_credit_lines;

create policy "finance_credit_lines_select_authenticated"
on public.finance_credit_lines
for select
to authenticated
using (true);

-- Permite que la planificacion financiera lea cuentas/caja.
-- No concede permisos de escritura.
drop policy if exists "finance_cash_accounts_select_authenticated"
on public.finance_cash_accounts;

create policy "finance_cash_accounts_select_authenticated"
on public.finance_cash_accounts
for select
to authenticated
using (true);

-- Permite que la planificacion financiera lea vencimientos agrupados de lineas.
-- No concede permisos de escritura.
drop policy if exists "finance_credit_line_repayment_groups_select_authenticated"
on public.finance_credit_line_repayment_groups;

create policy "finance_credit_line_repayment_groups_select_authenticated"
on public.finance_credit_line_repayment_groups
for select
to authenticated
using (true);
