-- Flujo financiero operativo local: tesoreria asignada, ingresos Amazon y refinanciacion.
-- Incremental y no destructiva. No ejecuta fixtures.

begin;

alter table public.finance_cash_accounts
  add column if not exists is_operating_treasury boolean not null default false;

insert into public.finance_settings(key,value,updated_at)
values ('minimum_operating_cash_reserve_eur','20000',now())
on conflict (key) do nothing;

create table if not exists public.finance_operating_treasury_operations (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.finance_cash_accounts(id) on delete restrict,
  operation_type text not null check (operation_type in ('contribution','withdrawal','opening_adjustment')),
  direction text not null check (direction in ('in','out')),
  amount_eur numeric(14,2) not null check (public.finance_is_finite_numeric(amount_eur) and amount_eur > 0),
  effective_date date not null,
  reference text,
  notes text,
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  payload_fingerprint text not null,
  cash_movement_id uuid not null unique references public.finance_cash_movements(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.finance_amazon_income_forecasts
  add column if not exists source_key text,
  add column if not exists marketplace text,
  add column if not exists cycle_start date,
  add column if not exists cycle_end date,
  add column if not exists estimated_gross_eur numeric(14,2),
  add column if not exists historical_net_ratio numeric(9,6),
  add column if not exists confirmed_amount_eur numeric(14,2),
  add column if not exists received_amount_eur numeric(14,2),
  add column if not exists received_at timestamptz,
  add column if not exists cash_account_id uuid references public.finance_cash_accounts(id) on delete restrict,
  add column if not exists cash_movement_id uuid unique references public.finance_cash_movements(id) on delete restrict,
  add column if not exists idempotency_key text;

create unique index if not exists finance_amazon_income_forecasts_source_key_uq
  on public.finance_amazon_income_forecasts(source_key) where source_key is not null;
create unique index if not exists finance_amazon_income_forecasts_idempotency_uq
  on public.finance_amazon_income_forecasts(idempotency_key) where idempotency_key is not null;

alter table public.finance_amazon_income_forecasts
  drop constraint if exists finance_amazon_income_forecasts_status_check;
alter table public.finance_amazon_income_forecasts
  add constraint finance_amazon_income_forecasts_status_check
  check (status in ('previsto','projected','accumulated','confirmed','received'));

create table if not exists public.finance_credit_line_refinancings (
  id uuid primary key default gen_random_uuid(),
  source_repayment_group_id uuid not null references public.finance_credit_line_repayment_groups(id) on delete restrict,
  source_credit_line_id uuid not null references public.finance_credit_lines(id) on delete restrict,
  funding_credit_line_id uuid not null references public.finance_credit_lines(id) on delete restrict,
  funding_repayment_group_id uuid not null references public.finance_credit_line_repayment_groups(id) on delete restrict,
  funding_drawdown_movement_id uuid not null unique references public.finance_credit_line_movements(id) on delete restrict,
  source_repayment_movement_id uuid not null unique references public.finance_credit_line_movements(id) on delete restrict,
  principal_eur numeric(14,2) not null,
  interest_eur numeric(14,2) not null,
  fees_eur numeric(14,2) not null,
  funded_total_eur numeric(14,2) not null,
  refinanced_amount_eur numeric(14,2) not null,
  effective_date date not null,
  funding_due_date date not null,
  reference text,
  notes text,
  idempotency_key text not null unique check (btrim(idempotency_key) <> ''),
  payload_fingerprint text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_credit_line_id <> funding_credit_line_id),
  check (public.finance_is_finite_numeric(principal_eur) and principal_eur > 0),
  check (public.finance_is_finite_numeric(interest_eur) and interest_eur >= 0),
  check (public.finance_is_finite_numeric(fees_eur) and fees_eur >= 0),
  check (funded_total_eur = principal_eur + interest_eur + fees_eur),
  check (refinanced_amount_eur = principal_eur)
);

alter table public.finance_operating_treasury_operations enable row level security;
alter table public.finance_credit_line_refinancings enable row level security;

drop policy if exists finance_operating_treasury_operations_select on public.finance_operating_treasury_operations;
create policy finance_operating_treasury_operations_select on public.finance_operating_treasury_operations
for select to authenticated using (public.finance_can_read_treasury());
drop policy if exists finance_credit_line_refinancings_select on public.finance_credit_line_refinancings;
create policy finance_credit_line_refinancings_select on public.finance_credit_line_refinancings
for select to authenticated using (public.finance_can_read_unlinked_details());

revoke all on public.finance_operating_treasury_operations from public,anon,authenticated;
revoke all on public.finance_credit_line_refinancings from public,anon,authenticated;
grant select on public.finance_operating_treasury_operations to authenticated,service_role;
grant select on public.finance_credit_line_refinancings to authenticated,service_role;
grant all on public.finance_operating_treasury_operations to service_role;
grant all on public.finance_credit_line_refinancings to service_role;

create or replace function public.finance_record_operating_treasury_operation(
  p_cash_account_id uuid,
  p_operation_type text,
  p_direction text,
  p_amount_eur numeric,
  p_effective_date date,
  p_reference text,
  p_notes text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_account public.finance_cash_accounts%rowtype;
  v_existing public.finance_operating_treasury_operations%rowtype;
  v_operation public.finance_operating_treasury_operations%rowtype;
  v_amount numeric(14,2);
  v_type text := lower(btrim(coalesce(p_operation_type,'')));
  v_direction text := lower(btrim(coalesce(p_direction,'')));
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_fingerprint text;
  v_movement_id uuid := gen_random_uuid();
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_type not in ('contribution','withdrawal','opening_adjustment') then raise exception 'INVALID_OPERATION_TYPE'; end if;
  if v_direction not in ('in','out') then raise exception 'INVALID_DIRECTION'; end if;
  if v_type='contribution' and v_direction<>'in' then raise exception 'INVALID_DIRECTION'; end if;
  if v_type='withdrawal' and v_direction<>'out' then raise exception 'INVALID_DIRECTION'; end if;
  if p_effective_date is null or v_key is null then raise exception 'REQUIRED_FIELDS'; end if;
  v_amount := round(public.finance_assert_finite_money(p_amount_eur,'amount_eur'),2);
  v_fingerprint := md5(jsonb_build_object('account',p_cash_account_id,'type',v_type,'direction',v_direction,'amount',v_amount,'date',p_effective_date,'reference',nullif(btrim(p_reference),''),'notes',nullif(btrim(p_notes),''))::text);
  perform pg_advisory_xact_lock(hashtextextended('operating-treasury:'||v_key,0));
  select * into v_existing from public.finance_operating_treasury_operations where idempotency_key=v_key;
  if found then
    if v_existing.payload_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('operation_id',v_existing.id,'cash_movement_id',v_existing.cash_movement_id,'cash_balance_eur',(select balance from public.finance_cash_accounts where id=v_existing.cash_account_id),'idempotent',true);
  end if;
  select * into v_account from public.finance_cash_accounts where id=p_cash_account_id for update;
  if not found then raise exception 'NOT_FOUND: cash account'; end if;
  if not v_account.is_operating_treasury then raise exception 'NOT_OPERATING_TREASURY_ACCOUNT'; end if;
  if upper(btrim(v_account.currency))<>'EUR' or lower(btrim(v_account.status))<>'active' then raise exception 'INVALID_CASH_ACCOUNT'; end if;
  if v_direction='out' and v_account.balance<v_amount then raise exception 'INSUFFICIENT_CASH'; end if;
  insert into public.finance_cash_movements(id,cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes)
  values(v_movement_id,v_account.id,'adjustment',v_direction,v_amount,'operating_treasury_operation',null,p_effective_date,nullif(concat_ws(' | ',p_reference,p_notes),''));
  update public.finance_cash_accounts set balance=round(balance + case when v_direction='in' then v_amount else -v_amount end,2),updated_at=now() where id=v_account.id returning * into v_account;
  insert into public.finance_operating_treasury_operations(cash_account_id,operation_type,direction,amount_eur,effective_date,reference,notes,idempotency_key,payload_fingerprint,cash_movement_id,created_by)
  values(v_account.id,v_type,v_direction,v_amount,p_effective_date,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_key,v_fingerprint,v_movement_id,auth.uid()) returning * into v_operation;
  update public.finance_cash_movements set source_id=v_operation.id where id=v_movement_id;
  return jsonb_build_object('operation_id',v_operation.id,'cash_movement_id',v_movement_id,'cash_balance_eur',v_account.balance,'idempotent',false);
end $$;

create or replace function public.finance_receive_amazon_income(
  p_forecast_id uuid,
  p_cash_account_id uuid,
  p_received_amount_eur numeric,
  p_received_at timestamptz,
  p_reference text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_forecast public.finance_amazon_income_forecasts%rowtype;
  v_account public.finance_cash_accounts%rowtype;
  v_amount numeric(14,2);
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_movement_id uuid := gen_random_uuid();
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if p_received_at is null or v_key is null then raise exception 'REQUIRED_FIELDS'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_received_amount_eur,'received_amount_eur'),2);
  perform pg_advisory_xact_lock(hashtextextended('amazon-income:'||v_key,0));
  select * into v_forecast from public.finance_amazon_income_forecasts where idempotency_key=v_key or id=p_forecast_id order by (idempotency_key=v_key) desc limit 1 for update;
  if not found then raise exception 'NOT_FOUND: forecast'; end if;
  if v_forecast.status='received' then
    if v_forecast.idempotency_key is distinct from v_key or v_forecast.received_amount_eur is distinct from v_amount or v_forecast.cash_account_id is distinct from p_cash_account_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('forecast_id',v_forecast.id,'cash_movement_id',v_forecast.cash_movement_id,'received_amount_eur',v_forecast.received_amount_eur,'idempotent',true);
  end if;
  select * into v_account from public.finance_cash_accounts where id=p_cash_account_id for update;
  if not found or not v_account.is_operating_treasury then raise exception 'NOT_OPERATING_TREASURY_ACCOUNT'; end if;
  insert into public.finance_cash_movements(id,cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes)
  values(v_movement_id,v_account.id,'income','in',v_amount,'amazon_income_forecast',v_forecast.id,p_received_at::date,nullif(btrim(p_reference),''));
  update public.finance_cash_accounts set balance=round(balance+v_amount,2),updated_at=now() where id=v_account.id returning * into v_account;
  update public.finance_amazon_income_forecasts set status='received',received_amount_eur=v_amount,received_at=p_received_at,cash_account_id=v_account.id,cash_movement_id=v_movement_id,idempotency_key=v_key,updated_at=now() where id=v_forecast.id returning * into v_forecast;
  return jsonb_build_object('forecast_id',v_forecast.id,'cash_movement_id',v_movement_id,'received_amount_eur',v_amount,'cash_balance_eur',v_account.balance,'idempotent',false);
end $$;

create or replace function public.finance_refinance_credit_line(
  p_source_repayment_group_id uuid,
  p_funding_credit_line_id uuid,
  p_effective_date date,
  p_principal_eur numeric,
  p_interest_eur numeric,
  p_fees_eur numeric,
  p_funding_manual_due_date date,
  p_reference text,
  p_notes text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_source_group public.finance_credit_line_repayment_groups%rowtype;
  v_source_line public.finance_credit_lines%rowtype;
  v_funding_line public.finance_credit_lines%rowtype;
  v_funding_group public.finance_credit_line_repayment_groups%rowtype;
  v_existing public.finance_credit_line_refinancings%rowtype;
  v_operation public.finance_credit_line_refinancings%rowtype;
  v_principal numeric(14,2); v_interest numeric(14,2); v_fees numeric(14,2); v_total numeric(14,2);
  v_due_date date; v_key text:=nullif(btrim(p_idempotency_key),''); v_fingerprint text;
  v_drawdown_id uuid:=gen_random_uuid(); v_repayment_id uuid:=gen_random_uuid();
  v_next_remaining numeric(14,2); v_next_paid numeric(14,2); v_next_status text;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if p_effective_date is null or v_key is null then raise exception 'REQUIRED_FIELDS'; end if;
  if not public.finance_is_finite_numeric(p_principal_eur) or not public.finance_is_finite_numeric(p_interest_eur) or not public.finance_is_finite_numeric(p_fees_eur) then raise exception 'INVALID_AMOUNT'; end if;
  v_principal:=round(p_principal_eur,2);v_interest:=round(p_interest_eur,2);v_fees:=round(p_fees_eur,2);v_total:=v_principal+v_interest+v_fees;
  if v_principal<=0 or v_interest<0 or v_fees<0 then raise exception 'INVALID_AMOUNT'; end if;
  v_fingerprint:=md5(jsonb_build_object('source_group',p_source_repayment_group_id,'funding_line',p_funding_credit_line_id,'date',p_effective_date,'principal',v_principal,'interest',v_interest,'fees',v_fees,'manual_due',p_funding_manual_due_date,'reference',nullif(btrim(p_reference),''),'notes',nullif(btrim(p_notes),''))::text);
  perform pg_advisory_xact_lock(hashtextextended('credit-line-refinancing:'||v_key,0));
  select * into v_existing from public.finance_credit_line_refinancings where idempotency_key=v_key;
  if found then
    if v_existing.payload_fingerprint<>v_fingerprint then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('refinancing_id',v_existing.id,'source_credit_line_id',v_existing.source_credit_line_id,'funding_credit_line_id',v_existing.funding_credit_line_id,'funding_repayment_group_id',v_existing.funding_repayment_group_id,'principal_eur',v_existing.principal_eur,'interest_eur',v_existing.interest_eur,'fees_eur',v_existing.fees_eur,'funded_total_eur',v_existing.funded_total_eur,'funding_due_date',v_existing.funding_due_date,'idempotent',true);
  end if;
  select * into v_source_group from public.finance_credit_line_repayment_groups where id=p_source_repayment_group_id;
  if not found then raise exception 'NOT_FOUND: source repayment group'; end if;
  if v_source_group.credit_line_id=p_funding_credit_line_id then raise exception 'SAME_CREDIT_LINE'; end if;
  perform 1 from public.finance_credit_lines where id in(v_source_group.credit_line_id,p_funding_credit_line_id) order by id for update;
  select * into v_source_line from public.finance_credit_lines where id=v_source_group.credit_line_id;
  select * into v_funding_line from public.finance_credit_lines where id=p_funding_credit_line_id;
  select * into v_source_group from public.finance_credit_line_repayment_groups where id=p_source_repayment_group_id for update;
  if v_source_group.status not in('open','partially_paid') or v_principal>v_source_group.remaining_amount or v_principal>v_source_line.used_amount then raise exception 'PRINCIPAL_EXCEEDS_OUTSTANDING'; end if;
  if lower(btrim(v_funding_line.status)) not in('activa','activo','active') then raise exception 'CREDIT_LINE_INACTIVE'; end if;
  if v_funding_line.available_amount<v_total then raise exception 'INSUFFICIENT_CREDIT'; end if;
  if v_funding_line.cycle_days is null then
    if p_funding_manual_due_date is null then raise exception 'MANUAL_DUE_DATE_REQUIRED'; end if;
    if p_funding_manual_due_date<p_effective_date then raise exception 'INVALID_DATE'; end if;
    v_due_date:=p_funding_manual_due_date;
  else
    if p_funding_manual_due_date is not null then raise exception 'MANUAL_DUE_DATE_NOT_ALLOWED'; end if;
    v_due_date:=p_effective_date+v_funding_line.cycle_days;
  end if;
  insert into public.finance_credit_line_repayment_groups(credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type)
  values(v_funding_line.id,p_effective_date,v_due_date,v_due_date,v_total,0,v_total,'open','operational_cycle') returning * into v_funding_group;
  insert into public.finance_credit_line_movements(id,credit_line_id,movement_type,description,due_date,amount,status,source_type,source_id,movement_date,repayment_group_id,idempotency_key,bank_reference)
  values(v_drawdown_id,v_funding_line.id,'drawdown','Disposicion por refinanciacion',v_due_date,v_total,'posted','credit_line_refinancing',null,p_effective_date,v_funding_group.id,'refinance-drawdown:'||v_key,nullif(btrim(p_reference),''));
  insert into public.finance_credit_line_movements(id,credit_line_id,movement_type,description,due_date,paid_at,amount,status,source_type,source_id,movement_date,repayment_group_id,idempotency_key,bank_reference)
  values(v_repayment_id,v_source_line.id,'repayment','Principal amortizado por refinanciacion',v_source_group.due_date,p_effective_date::timestamptz,v_principal,'posted','credit_line_refinancing',null,p_effective_date,v_source_group.id,'refinance-repayment:'||v_key,nullif(btrim(p_reference),''));
  update public.finance_credit_lines set used_amount=round(used_amount-v_principal,2),available_amount=round(available_amount+v_principal,2),updated_at=now() where id=v_source_line.id;
  update public.finance_credit_lines set used_amount=round(used_amount+v_total,2),available_amount=round(available_amount-v_total,2),updated_at=now() where id=v_funding_line.id;
  v_next_remaining:=round(v_source_group.remaining_amount-v_principal,2);v_next_paid:=round(v_source_group.paid_amount+v_principal,2);v_next_status:=case when v_next_remaining=0 then 'paid' else 'partially_paid' end;
  update public.finance_credit_line_repayment_groups set remaining_amount=v_next_remaining,paid_amount=v_next_paid,status=v_next_status,paid_at=case when v_next_remaining=0 then p_effective_date::timestamptz else null end,updated_at=now() where id=v_source_group.id;
  insert into public.finance_credit_line_refinancings(source_repayment_group_id,source_credit_line_id,funding_credit_line_id,funding_repayment_group_id,funding_drawdown_movement_id,source_repayment_movement_id,principal_eur,interest_eur,fees_eur,funded_total_eur,refinanced_amount_eur,effective_date,funding_due_date,reference,notes,idempotency_key,payload_fingerprint,created_by)
  values(v_source_group.id,v_source_line.id,v_funding_line.id,v_funding_group.id,v_drawdown_id,v_repayment_id,v_principal,v_interest,v_fees,v_total,v_principal,p_effective_date,v_due_date,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),v_key,v_fingerprint,auth.uid()) returning * into v_operation;
  update public.finance_credit_line_movements set source_id=v_operation.id where id in(v_drawdown_id,v_repayment_id);
  return jsonb_build_object('refinancing_id',v_operation.id,'source_credit_line_id',v_source_line.id,'funding_credit_line_id',v_funding_line.id,'funding_repayment_group_id',v_funding_group.id,'principal_eur',v_principal,'interest_eur',v_interest,'fees_eur',v_fees,'funded_total_eur',v_total,'funding_due_date',v_due_date,'source_credit_used_eur',v_source_line.used_amount-v_principal,'funding_credit_used_eur',v_funding_line.used_amount+v_total,'idempotent',false);
end $$;

revoke all on function public.finance_record_operating_treasury_operation(uuid,text,text,numeric,date,text,text,text) from public,anon;
revoke all on function public.finance_receive_amazon_income(uuid,uuid,numeric,timestamptz,text,text) from public,anon;
revoke all on function public.finance_refinance_credit_line(uuid,uuid,date,numeric,numeric,numeric,date,text,text,text) from public,anon;
grant execute on function public.finance_record_operating_treasury_operation(uuid,text,text,numeric,date,text,text,text) to authenticated,service_role;
grant execute on function public.finance_receive_amazon_income(uuid,uuid,numeric,timestamptz,text,text) to authenticated,service_role;
grant execute on function public.finance_refinance_credit_line(uuid,uuid,date,numeric,numeric,numeric,date,text,text,text) to authenticated,service_role;

commit;
