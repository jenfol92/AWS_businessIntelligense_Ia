begin;
create table if not exists public.finance_supplier_payment_executions (
  id uuid primary key default gen_random_uuid(),
  supplier_payment_id uuid not null references public.finance_supplier_payments(id) on delete restrict,
  idempotency_key text not null unique check (btrim(idempotency_key)<>''),
  payload_fingerprint text not null,
  result jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.finance_supplier_payment_executions enable row level security;
drop policy if exists finance_supplier_payment_executions_select on public.finance_supplier_payment_executions;
create policy finance_supplier_payment_executions_select on public.finance_supplier_payment_executions for select to authenticated using(public.finance_can_read_unlinked_details());
revoke all on public.finance_supplier_payment_executions from public,anon,authenticated;
grant select on public.finance_supplier_payment_executions to authenticated,service_role;
grant all on public.finance_supplier_payment_executions to service_role;

create or replace function public.finance_execute_supplier_payment(
  p_supplier_payment_id uuid,p_order_id uuid,p_paid_at timestamptz,p_actual_fx_rate numeric,p_actual_amount_eur numeric,
  p_bank_reference text,p_bank_fee_eur numeric,p_ff_fee_eur numeric,p_notes text,p_source_type text,
  p_cash_account_id uuid,p_credit_line_id uuid,p_manual_due_date date,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text:=nullif(btrim(p_idempotency_key),'');v_fingerprint text;v_existing public.finance_supplier_payment_executions%rowtype;v_result jsonb;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  v_fingerprint:=md5(jsonb_build_object('payment',p_supplier_payment_id,'order',p_order_id,'paid_at',p_paid_at,'fx',p_actual_fx_rate,'amount',p_actual_amount_eur,'reference',nullif(btrim(p_bank_reference),''),'bank_fee',p_bank_fee_eur,'ff_fee',p_ff_fee_eur,'notes',nullif(btrim(p_notes),''),'source',p_source_type,'cash',p_cash_account_id,'line',p_credit_line_id,'manual_due',p_manual_due_date)::text);
  perform pg_advisory_xact_lock(hashtextextended('supplier-payment-execution:'||v_key,0));
  select * into v_existing from public.finance_supplier_payment_executions where idempotency_key=v_key;
  if found then
    if v_existing.payload_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return v_existing.result||jsonb_build_object('idempotent',true);
  end if;
  v_result:=public.mark_and_finance_supplier_payment(p_supplier_payment_id,p_order_id,p_paid_at,p_actual_fx_rate,p_actual_amount_eur,p_bank_reference,p_bank_fee_eur,p_ff_fee_eur,p_notes,p_source_type,p_cash_account_id,p_credit_line_id,p_manual_due_date);
  insert into public.finance_supplier_payment_executions(supplier_payment_id,idempotency_key,payload_fingerprint,result,created_by) values(p_supplier_payment_id,v_key,v_fingerprint,v_result,auth.uid());
  return v_result||jsonb_build_object('idempotent',false);
end $$;
revoke all on function public.finance_execute_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date,text) from public,anon;
grant execute on function public.finance_execute_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date,text) to authenticated,service_role;
commit;
