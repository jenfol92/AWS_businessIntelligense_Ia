begin;

alter table public.ordenes_compra
  add column if not exists planned_fx_foreign_per_eur numeric(18,8);
alter table public.finance_supplier_payments
  add column if not exists planned_fx_foreign_per_eur numeric(18,8),
  add column if not exists actual_fx_foreign_per_eur numeric(18,8),
  add column if not exists planned_fx_regularization_status text not null default 'pending_review';
alter table public.finance_purchase_payment_batches
  add column if not exists actual_fx_foreign_per_eur numeric(18,8);
alter table public.finance_supplier_payment_executions
  add column if not exists actual_fx_foreign_per_eur numeric(18,8);

comment on column public.ordenes_compra.planned_fx_foreign_per_eur is
  'FX estimado de planificación capturado al confirmar: 1 EUR = X moneda_compra. No es coste real.';
comment on column public.finance_supplier_payments.planned_fx_foreign_per_eur is
  'Snapshot inmutable de planificación: 1 EUR = X original_currency; amount_eur = amount_original / este FX.';
comment on column public.finance_supplier_payments.planned_fx_rate is
  'LEGACY: convención histórica no reinterpretada. No usar para nuevas obligaciones.';
comment on column public.finance_supplier_payments.actual_fx_rate is
  'LEGACY: 1 unidad de original_currency = X EUR. Puede ser media derivada; no reconstruye allocations.';
comment on column public.finance_supplier_payments.actual_fx_foreign_per_eur is
  'Informativo para ejecuciones nuevas: 1 EUR = X original_currency. EUR reales viven en actual_amount_eur/allocations.';
comment on column public.finance_purchase_payment_batches.actual_fx_foreign_per_eur is
  'FX real individual del batch: 1 EUR = X original_currency. actual_fx_rate conserva el inverso legacy.';

alter table public.ordenes_compra
  add constraint ordenes_compra_planned_fx_foreign_per_eur_positive
  check (planned_fx_foreign_per_eur is null or (planned_fx_foreign_per_eur>0 and planned_fx_foreign_per_eur::text not in ('NaN','Infinity','-Infinity'))) not valid;
alter table public.finance_supplier_payments
  add constraint finance_supplier_payments_planned_fx_foreign_per_eur_positive
  check (planned_fx_foreign_per_eur is null or (planned_fx_foreign_per_eur>0 and planned_fx_foreign_per_eur::text not in ('NaN','Infinity','-Infinity'))) not valid;
alter table public.finance_supplier_payments
  add constraint finance_supplier_payments_new_plan_not_silent_zero
  check (planned_fx_regularization_status<>'complete' or status in ('anulado','inactive') or upper(original_currency)='EUR' or (planned_fx_foreign_per_eur is not null and planned_fx_foreign_per_eur>0 and amount_eur>0)) not valid;
alter table public.finance_supplier_payments
  add constraint finance_supplier_payments_fx_regularization_status_check
  check (planned_fx_regularization_status in ('complete','pending_review','manual_required')) not valid;
alter table public.finance_purchase_payment_batches
  add constraint finance_purchase_payment_batches_actual_fx_foreign_per_eur_positive
  check (actual_fx_foreign_per_eur is null or (actual_fx_foreign_per_eur>0 and actual_fx_foreign_per_eur::text not in ('NaN','Infinity','-Infinity'))) not valid;

create or replace function public.finance_protect_supplier_payment_history()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if (old.status in ('parcial','pagado') or old.paid_at is not null or old.actual_amount_original is not null or old.actual_amount_eur is not null
      or exists(select 1 from public.finance_purchase_payment_allocations a where a.supplier_payment_id=old.id))
     and (new.planned_fx_foreign_per_eur is distinct from old.planned_fx_foreign_per_eur
          or new.planned_fx_rate is distinct from old.planned_fx_rate
          or new.amount_eur is distinct from old.amount_eur
          or new.amount_original is distinct from old.amount_original
          or new.original_currency is distinct from old.original_currency) then
    raise exception 'HISTORICAL_PAYMENT_PLAN_IMMUTABLE';
  end if;
  return new;
end $$;
drop trigger if exists trg_finance_protect_supplier_payment_history on public.finance_supplier_payments;
create trigger trg_finance_protect_supplier_payment_history before update on public.finance_supplier_payments
for each row execute function public.finance_protect_supplier_payment_history();

create or replace function public.confirm_order_with_planned_fx(
  p_order_id uuid,p_confirmation_date date,p_eta date,p_etd date,p_eta_real date,
  p_lead_time_produccion integer,p_lead_time_transito integer,p_numero_pedido_agente text,
  p_agente_id uuid,p_moneda_compra text,p_planned_fx_foreign_per_eur numeric,
  p_tipo_cambio_moneda_eur numeric,p_tipo_cambio_usd_eur numeric,p_deposito_porcentaje numeric,
  p_balance_dias_antes_eta integer,p_balance_condiciones_texto text,p_items jsonb
) returns public.ordenes_compra
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_currency text:=upper(btrim(coalesce(p_moneda_compra,'USD')));v_fx numeric;v_order public.ordenes_compra%rowtype;
begin
  v_fx:=case when v_currency='EUR' then 1 else p_planned_fx_foreign_per_eur end;
  if v_fx is null or v_fx<=0 or v_fx::text in ('NaN','Infinity','-Infinity') then raise exception 'PLANNED_FX_REQUIRED'; end if;
  v_order:=public.confirm_order_with_effective_date(
    p_order_id,p_confirmation_date,p_eta,p_etd,p_eta_real,p_lead_time_produccion,p_lead_time_transito,
    p_numero_pedido_agente,p_agente_id,v_currency,p_tipo_cambio_moneda_eur,p_tipo_cambio_usd_eur,
    p_deposito_porcentaje,p_balance_dias_antes_eta,p_balance_condiciones_texto,p_items);
  update public.ordenes_compra set planned_fx_foreign_per_eur=v_fx,updated_at=now()
  where id=p_order_id returning * into v_order;
  return v_order;
end $$;

create or replace function public.sync_supplier_payment_plan_fx_v2(
  p_order_id uuid,p_payment_type text,p_due_date date,p_amount_original numeric,p_original_currency text,
  p_planned_fx_rate numeric,p_planned_fx_foreign_per_eur numeric,p_amount_eur numeric,p_logistics_type text,
  p_container_id uuid,p_status text,p_notes text default null,p_update_notes boolean default false
) returns public.finance_supplier_payments
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_currency text:=upper(btrim(p_original_currency));v_fx numeric;v_expected numeric;v_existing public.finance_supplier_payments%rowtype;v_row public.finance_supplier_payments%rowtype;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  v_fx:=case when v_currency='EUR' then 1 else p_planned_fx_foreign_per_eur end;
  if v_fx is null or v_fx<=0 or v_fx::text in ('NaN','Infinity','-Infinity') then raise exception 'PLANNED_FX_REQUIRED'; end if;
  v_expected:=round(p_amount_original/v_fx,4);
  if abs(v_expected-round(p_amount_eur,4))>0.0001 then raise exception 'INCONSISTENT_PLANNED_AMOUNT_EUR'; end if;
  select * into v_existing from public.finance_supplier_payments where orden_id=p_order_id and payment_type=p_payment_type for update;
  if found and (v_existing.status in ('parcial','pagado') or v_existing.paid_at is not null or v_existing.actual_amount_original is not null or v_existing.actual_amount_eur is not null or exists(select 1 from public.finance_purchase_payment_allocations a where a.supplier_payment_id=v_existing.id)) then return v_existing; end if;
  v_row:=public.sync_supplier_payment_plan_protected(p_order_id,p_payment_type,p_due_date,p_amount_original,v_currency,p_planned_fx_rate,v_expected,p_logistics_type,p_container_id,p_status,p_notes,p_update_notes);
  update public.finance_supplier_payments set planned_fx_foreign_per_eur=v_fx,planned_fx_regularization_status='complete' where id=v_row.id returning * into v_row;
  return v_row;
end $$;

create or replace function public.finance_execute_supplier_payment_fx_v2(
  p_supplier_payment_id uuid,p_order_id uuid,p_paid_at timestamptz,p_actual_fx_rate numeric,
  p_actual_fx_foreign_per_eur numeric,p_actual_amount_eur numeric,p_bank_reference text,
  p_bank_fee_eur numeric,p_ff_fee_eur numeric,p_notes text,p_source_type text,
  p_cash_account_id uuid,p_credit_line_id uuid,p_manual_due_date date,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payment public.finance_supplier_payments%rowtype;v_fx_new numeric;v_fx_legacy numeric;v_eur numeric;v_result jsonb;
begin
  select * into v_payment from public.finance_supplier_payments where id=p_supplier_payment_id;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;
  v_fx_new:=case when upper(v_payment.original_currency)='EUR' then 1 else p_actual_fx_foreign_per_eur end;
  v_fx_legacy:=case when v_fx_new is not null then 1/v_fx_new else p_actual_fx_rate end;
  v_eur:=coalesce(p_actual_amount_eur,case when v_fx_new is not null then round(v_payment.amount_original/v_fx_new,2) else null end);
  v_result:=public.finance_execute_supplier_payment(p_supplier_payment_id,p_order_id,p_paid_at,v_fx_legacy,v_eur,p_bank_reference,p_bank_fee_eur,p_ff_fee_eur,p_notes,p_source_type,p_cash_account_id,p_credit_line_id,p_manual_due_date,p_idempotency_key);
  if v_fx_new is not null then
    update public.finance_supplier_payments set actual_fx_foreign_per_eur=v_fx_new where id=p_supplier_payment_id;
    update public.finance_supplier_payment_executions set actual_fx_foreign_per_eur=v_fx_new where idempotency_key=p_idempotency_key;
  end if;
  return v_result;
end $$;

create or replace function public.create_and_apply_purchase_payment_batch_fx_v2(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_payload jsonb:=p_payload;v_fx_new numeric;v_fx_legacy numeric;v_original numeric;v_eur numeric;v_result jsonb;v_batch_id uuid;
begin
  v_fx_new:=nullif(v_payload->>'actual_fx_foreign_per_eur','')::numeric;
  v_original:=(v_payload->>'amount_original')::numeric;
  if upper(v_payload->>'original_currency')='EUR' then v_fx_new:=1; end if;
  if v_fx_new is not null then
    if v_fx_new<=0 or v_fx_new::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_ACTUAL_FX_FOREIGN_PER_EUR'; end if;
    v_fx_legacy:=1/v_fx_new;v_eur:=round(v_original/v_fx_new,2);
    if nullif(v_payload->>'actual_amount_eur','') is not null and abs((v_payload->>'actual_amount_eur')::numeric-v_eur)>0.01 then raise exception 'INCONSISTENT_ACTUAL_VALUES'; end if;
    v_payload:=v_payload||jsonb_build_object('actual_fx_rate',v_fx_legacy,'actual_amount_eur',v_eur)-'actual_fx_foreign_per_eur';
  end if;
  v_result:=public.create_and_apply_purchase_payment_batch(v_payload);
  v_batch_id:=(v_result->'batch'->>'id')::uuid;
  if v_batch_id is not null and v_fx_new is not null then update public.finance_purchase_payment_batches set actual_fx_foreign_per_eur=v_fx_new where id=v_batch_id; end if;
  return v_result;
end $$;

revoke all on function public.confirm_order_with_planned_fx(uuid,date,date,date,date,integer,integer,text,uuid,text,numeric,numeric,numeric,numeric,integer,text,jsonb) from public,anon;
grant execute on function public.confirm_order_with_planned_fx(uuid,date,date,date,date,integer,integer,text,uuid,text,numeric,numeric,numeric,numeric,integer,text,jsonb) to authenticated,service_role;
revoke all on function public.sync_supplier_payment_plan_fx_v2(uuid,text,date,numeric,text,numeric,numeric,numeric,text,uuid,text,text,boolean) from public,anon;
grant execute on function public.sync_supplier_payment_plan_fx_v2(uuid,text,date,numeric,text,numeric,numeric,numeric,text,uuid,text,text,boolean) to authenticated,service_role;
revoke all on function public.finance_execute_supplier_payment_fx_v2(uuid,uuid,timestamptz,numeric,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date,text) from public,anon;
grant execute on function public.finance_execute_supplier_payment_fx_v2(uuid,uuid,timestamptz,numeric,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date,text) to authenticated,service_role;
revoke all on function public.create_and_apply_purchase_payment_batch_fx_v2(jsonb) from public,anon;
grant execute on function public.create_and_apply_purchase_payment_batch_fx_v2(jsonb) to authenticated,service_role;

commit;
