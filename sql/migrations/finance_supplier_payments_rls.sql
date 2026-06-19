-- FASE 1: RLS para finance_supplier_payments (tabla ya existente).
-- Las rutas usan createSupabaseRouteClient() con usuario authenticated.

alter table public.finance_supplier_payments enable row level security;

drop policy if exists "finance_supplier_payments_select_authenticated"
  on public.finance_supplier_payments;
create policy "finance_supplier_payments_select_authenticated"
  on public.finance_supplier_payments
  for select
  to authenticated
  using (true);

drop policy if exists "finance_supplier_payments_insert_authenticated"
  on public.finance_supplier_payments;
create policy "finance_supplier_payments_insert_authenticated"
  on public.finance_supplier_payments
  for insert
  to authenticated
  with check (true);

drop policy if exists "finance_supplier_payments_update_authenticated"
  on public.finance_supplier_payments;
create policy "finance_supplier_payments_update_authenticated"
  on public.finance_supplier_payments
  for update
  to authenticated
  using (true)
  with check (true);
