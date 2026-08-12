begin;

alter table public.finance_credit_line_legacy_regularization_items
  add column if not exists expected_interest_eur numeric(14,2) null,
  add column if not exists expected_fees_eur numeric(14,2) null;

alter table public.finance_credit_line_legacy_regularization_items
  alter column disposition_date drop not null;

alter table public.finance_credit_line_legacy_regularization_items
  drop constraint if exists finance_credit_line_legacy_items_expected_costs_check;
alter table public.finance_credit_line_legacy_regularization_items
  add constraint finance_credit_line_legacy_items_expected_costs_check check (
    (expected_interest_eur is null or (public.finance_is_finite_numeric(expected_interest_eur) and expected_interest_eur >= 0))
    and (expected_fees_eur is null or (public.finance_is_finite_numeric(expected_fees_eur) and expected_fees_eur >= 0))
  );

drop index if exists public.ux_finance_credit_line_repayment_groups_legacy_due;
create index if not exists ix_finance_credit_line_repayment_groups_legacy_due
  on public.finance_credit_line_repayment_groups(group_origin_id,due_date)
  where status <> 'cancelled' and group_origin_type='legacy_regularization';

create or replace function public.finance_reject_spreadsheet_schedule_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.source_type='spreadsheet_schedule'
     and (tg_op='INSERT' or old.source_type is distinct from new.source_type) then
    raise exception 'SPREADSHEET_SCHEDULE_RETIRED';
  end if;
  return new;
end $$;

drop trigger if exists finance_planned_maturities_no_spreadsheet_schedule
  on public.finance_credit_line_planned_maturities;
create trigger finance_planned_maturities_no_spreadsheet_schedule
before insert or update of source_type on public.finance_credit_line_planned_maturities
for each row execute function public.finance_reject_spreadsheet_schedule_write();

create or replace function public.finance_register_legacy_opening_balance_v2(
  p_credit_line_id uuid,p_dispositions jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_line public.finance_credit_lines%rowtype;
  v_existing public.finance_credit_line_legacy_regularizations%rowtype;
  v_regularization_id uuid:=gen_random_uuid();
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_normalized jsonb; v_fingerprint text; v_explained numeric; v_gap numeric; v_total numeric:=0;
  v_item jsonb; v_principal numeric; v_interest numeric; v_fees numeric;
  v_disposition_date date; v_due_date date; v_reference text; v_notes text;
  v_item_id uuid; v_movement_id uuid; v_group_id uuid;
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if p_credit_line_id is null then raise exception 'NOT_FOUND: credit line is required'; end if;
  if v_key is null or length(v_key)>200 then raise exception 'INVALID_AMOUNT: invalid idempotency key'; end if;
  if p_dispositions is null or jsonb_typeof(p_dispositions)<>'array' or jsonb_array_length(p_dispositions)=0 or jsonb_array_length(p_dispositions)>500 then
    raise exception 'INVALID_AMOUNT: dispositions must be a non-empty array';
  end if;

  for v_item in select value from jsonb_array_elements(p_dispositions) loop
    if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) k where k not in
      ('principalEur','dispositionDate','contractualDueDate','reference','notes','expectedInterestEur','expectedFeesEur')) then
      raise exception 'INVALID_AMOUNT: invalid disposition object';
    end if;
    if jsonb_typeof(v_item->'principalEur')<>'number'
       or jsonb_typeof(v_item->'contractualDueDate')<>'string'
       or (v_item ? 'dispositionDate' and jsonb_typeof(v_item->'dispositionDate') not in ('string','null'))
       or (v_item ? 'reference' and jsonb_typeof(v_item->'reference') not in ('string','null'))
       or (v_item ? 'notes' and jsonb_typeof(v_item->'notes') not in ('string','null'))
       or (v_item ? 'expectedInterestEur' and jsonb_typeof(v_item->'expectedInterestEur') not in ('number','null'))
       or (v_item ? 'expectedFeesEur' and jsonb_typeof(v_item->'expectedFeesEur') not in ('number','null')) then
      raise exception 'INVALID_AMOUNT: invalid disposition value types';
    end if;
    begin
      v_principal:=(v_item->>'principalEur')::numeric;
      v_interest:=case when v_item->>'expectedInterestEur' is null then null else (v_item->>'expectedInterestEur')::numeric end;
      v_fees:=case when v_item->>'expectedFeesEur' is null then null else (v_item->>'expectedFeesEur')::numeric end;
      v_disposition_date:=(v_item->>'dispositionDate')::date;
      v_due_date:=(v_item->>'contractualDueDate')::date;
    exception when others then raise exception 'INVALID_AMOUNT: invalid disposition values'; end;
    if not public.finance_is_finite_numeric(v_principal) or v_principal<=0 or v_principal>=1000000000000 or v_principal<>round(v_principal,2)
      or (v_interest is not null and (not public.finance_is_finite_numeric(v_interest) or v_interest<0 or v_interest<>round(v_interest,2)))
      or (v_fees is not null and (not public.finance_is_finite_numeric(v_fees) or v_fees<0 or v_fees<>round(v_fees,2))) then
      raise exception 'INVALID_AMOUNT: invalid disposition money';
    end if;
    if v_due_date is null or v_disposition_date>current_date or v_disposition_date>v_due_date then raise exception 'INVALID_DATE: invalid disposition dates'; end if;
    if length(coalesce(v_item->>'reference',''))>250 or length(coalesce(v_item->>'notes',''))>2000 then raise exception 'INVALID_AMOUNT: disposition text is too long'; end if;
    v_total:=v_total+v_principal;
  end loop;

  select jsonb_agg(jsonb_build_object(
    'principalEur',round((x->>'principalEur')::numeric,2),
    'expectedInterestEur',case when x->>'expectedInterestEur' is null then null else round((x->>'expectedInterestEur')::numeric,2) end,
    'expectedFeesEur',case when x->>'expectedFeesEur' is null then null else round((x->>'expectedFeesEur')::numeric,2) end,
    'dispositionDate',(x->>'dispositionDate')::date,
    'contractualDueDate',(x->>'contractualDueDate')::date,
    'reference',nullif(btrim(x->>'reference'),''),'notes',nullif(btrim(x->>'notes'),'')
  ) order by (x->>'contractualDueDate')::date,(x->>'dispositionDate')::date nulls last,round((x->>'principalEur')::numeric,2),coalesce(x->>'reference',''))
  into v_normalized from jsonb_array_elements(p_dispositions) x;
  v_fingerprint:=md5(jsonb_build_object('creditLineId',p_credit_line_id,'dispositions',v_normalized)::text);

  perform pg_advisory_xact_lock(hashtextextended('legacy-regularization:'||v_key,0));
  select * into v_existing from public.finance_credit_line_legacy_regularizations where idempotency_key=v_key;
  if found then
    if v_existing.payload_fingerprint is distinct from v_fingerprint then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('regularization_id',v_existing.id,'credit_line_id',v_existing.credit_line_id,
      'derived_gap_eur',v_existing.derived_gap_eur,'declared_total_eur',v_existing.declared_total_eur,
      'groups',(select coalesce(jsonb_agg(jsonb_build_object('repayment_group_id',g.id,'contractual_due_date',g.due_date,'principal_eur',g.amount)),'[]'::jsonb) from public.finance_credit_line_repayment_groups g where g.group_origin_id=v_existing.id),
      'dispositions',(select coalesce(jsonb_agg(jsonb_build_object('disposition_id',i.id,'repayment_group_id',i.repayment_group_id,'credit_line_movement_id',i.credit_line_movement_id,'principal_eur',i.principal_eur,'expected_interest_eur',i.expected_interest_eur,'expected_fees_eur',i.expected_fees_eur,'disposition_date',i.disposition_date,'contractual_due_date',i.contractual_due_date)),'[]'::jsonb) from public.finance_credit_line_legacy_regularization_items i where i.regularization_id=v_existing.id),
      'idempotent',true);
  end if;

  select * into v_line from public.finance_credit_lines where id=p_credit_line_id for update;
  if not found then raise exception 'NOT_FOUND: credit line'; end if;
  if lower(btrim(coalesce(v_line.status,''))) in ('deleted','eliminada') then raise exception 'CREDIT_LINE_DELETED'; end if;
  select coalesce(sum(remaining_amount),0) into v_explained from public.finance_credit_line_repayment_groups
    where credit_line_id=p_credit_line_id and status in ('open','partially_paid');
  v_gap:=round(v_line.used_amount-v_explained,2);
  if v_gap<0 then raise exception 'EXPLAINED_PRINCIPAL_EXCEEDS_USED'; end if;
  if v_gap=0 then raise exception 'NO_LEGACY_GAP'; end if;
  if round(v_total,2)<v_gap then raise exception 'LEGACY_BREAKDOWN_BELOW_GAP'; end if;
  if round(v_total,2)>v_gap then raise exception 'LEGACY_BREAKDOWN_EXCEEDS_GAP'; end if;

  insert into public.finance_credit_line_legacy_regularizations(id,credit_line_id,derived_gap_eur,declared_total_eur,idempotency_key,payload_fingerprint,created_by)
    values(v_regularization_id,p_credit_line_id,v_gap,round(v_total,2),v_key,v_fingerprint,auth.uid());

  for v_item in select value from jsonb_array_elements(v_normalized) loop
    v_item_id:=gen_random_uuid(); v_movement_id:=gen_random_uuid(); v_group_id:=gen_random_uuid();
    v_principal:=(v_item->>'principalEur')::numeric;
    v_interest:=case when v_item->>'expectedInterestEur' is null then null else (v_item->>'expectedInterestEur')::numeric end;
    v_fees:=case when v_item->>'expectedFeesEur' is null then null else (v_item->>'expectedFeesEur')::numeric end;
    v_disposition_date:=(v_item->>'dispositionDate')::date; v_due_date:=(v_item->>'contractualDueDate')::date;
    v_reference:=nullif(btrim(v_item->>'reference'),''); v_notes:=nullif(btrim(v_item->>'notes'),'');
    insert into public.finance_credit_line_repayment_groups(id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type,group_origin_id)
      values(v_group_id,p_credit_line_id,coalesce(v_disposition_date,current_date),coalesce(v_disposition_date,current_date),v_due_date,v_principal,0,v_principal,'open','legacy_regularization',v_regularization_id);
    insert into public.finance_credit_line_movements(id,credit_line_id,movement_type,description,due_date,amount,status,source_type,source_id,movement_date,repayment_group_id,idempotency_key)
      values(v_movement_id,p_credit_line_id,'adjustment',coalesce(nullif(concat_ws(' | ','Saldo inicial legacy',v_reference,v_notes),''),'Saldo inicial legacy'),v_due_date,v_principal,'posted','legacy_opening_balance',v_item_id,coalesce(v_disposition_date,current_date),v_group_id,'legacy-item:'||v_item_id);
    insert into public.finance_credit_line_legacy_regularization_items(id,regularization_id,credit_line_id,principal_eur,expected_interest_eur,expected_fees_eur,disposition_date,contractual_due_date,reference,notes,repayment_group_id,credit_line_movement_id)
      values(v_item_id,v_regularization_id,p_credit_line_id,v_principal,v_interest,v_fees,v_disposition_date,v_due_date,v_reference,v_notes,v_group_id,v_movement_id);
  end loop;

  return jsonb_build_object('regularization_id',v_regularization_id,'credit_line_id',p_credit_line_id,'derived_gap_eur',v_gap,'declared_total_eur',round(v_total,2),
    'groups',(select jsonb_agg(jsonb_build_object('repayment_group_id',g.id,'contractual_due_date',g.due_date,'principal_eur',g.amount) order by g.due_date,g.id) from public.finance_credit_line_repayment_groups g where g.group_origin_id=v_regularization_id),
    'dispositions',(select jsonb_agg(jsonb_build_object('disposition_id',i.id,'repayment_group_id',i.repayment_group_id,'credit_line_movement_id',i.credit_line_movement_id,'principal_eur',i.principal_eur,'expected_interest_eur',i.expected_interest_eur,'expected_fees_eur',i.expected_fees_eur,'disposition_date',i.disposition_date,'contractual_due_date',i.contractual_due_date) order by i.contractual_due_date,i.disposition_date,i.id) from public.finance_credit_line_legacy_regularization_items i where i.regularization_id=v_regularization_id),
    'idempotent',false);
end $$;

alter function public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) owner to postgres;
revoke execute on function public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) from public,anon;
grant execute on function public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) to authenticated,service_role;

commit;
