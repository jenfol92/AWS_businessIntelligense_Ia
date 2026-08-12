\set ON_ERROR_STOP on
begin;
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';

insert into public.finance_cash_accounts(id,name,balance,currency,status,is_operating_treasury)
values('58000000-0000-4000-8000-000000000001','LEGACY TEST CASH',1000,'EUR','active',true);
insert into public.finance_credit_lines(id,bank_name,line_name,credit_limit,available_amount,used_amount,cycle_days,repayment_mode,status)
values
 ('58000000-0000-4000-8000-000000000011','TEST','LEGACY SOURCE',1000,900,100,90,'periodic_release','active'),
 ('58000000-0000-4000-8000-000000000012','TEST','REFI FUNDING',1000,1000,0,60,'periodic_release','active');

do $$
declare v_result jsonb; v_again jsonb; v_first uuid; v_second uuid; v_refi jsonb;
begin
  begin
    perform public.finance_register_legacy_opening_balance_v2(
      '58000000-0000-4000-8000-000000000011',
      '[{"principalEur":99.99,"contractualDueDate":"2026-09-30"}]','legacy-e2e-bad-gap');
    raise exception 'ASSERT: mismatched gap accepted';
  exception when others then
    if sqlerrm not like '%LEGACY_BREAKDOWN_BELOW_GAP%' then raise; end if;
  end;

  v_result:=public.finance_register_legacy_opening_balance_v2(
    '58000000-0000-4000-8000-000000000011',
    '[{"principalEur":40,"dispositionDate":null,"contractualDueDate":"2026-09-30","reference":"LEG-A","expectedInterestEur":8,"expectedFeesEur":2},{"principalEur":60,"dispositionDate":"2026-01-15","contractualDueDate":"2026-09-30","reference":"LEG-B"}]',
    'legacy-e2e-ok');
  if jsonb_array_length(v_result->'groups')<>2 or jsonb_array_length(v_result->'dispositions')<>2 then
    raise exception 'ASSERT: each tranche did not create one group: %',v_result;
  end if;
  if (select used_amount from public.finance_credit_lines where id='58000000-0000-4000-8000-000000000011')<>100 then
    raise exception 'ASSERT: regularization changed used amount';
  end if;
  if not exists(select 1 from public.finance_credit_line_legacy_regularization_items where regularization_id=(v_result->>'regularization_id')::uuid and disposition_date is null and expected_interest_eur=8 and expected_fees_eur=2) then
    raise exception 'ASSERT: optional legacy facts were not retained';
  end if;
  v_again:=public.finance_register_legacy_opening_balance_v2(
    '58000000-0000-4000-8000-000000000011',
    '[{"principalEur":40,"dispositionDate":null,"contractualDueDate":"2026-09-30","reference":"LEG-A","expectedInterestEur":8,"expectedFeesEur":2},{"principalEur":60,"dispositionDate":"2026-01-15","contractualDueDate":"2026-09-30","reference":"LEG-B"}]',
    'legacy-e2e-ok');
  if not (v_again->>'idempotent')::boolean then raise exception 'ASSERT: legacy idempotency'; end if;

  select repayment_group_id into v_first from public.finance_credit_line_legacy_regularization_items
    where regularization_id=(v_result->>'regularization_id')::uuid and principal_eur=40;
  select repayment_group_id into v_second from public.finance_credit_line_legacy_regularization_items
    where regularization_id=(v_result->>'regularization_id')::uuid and principal_eur=60;

  perform public.finance_create_credit_line_repayment_v2(
    '58000000-0000-4000-8000-000000000011',v_first,'58000000-0000-4000-8000-000000000001',10,5,2,current_date,'LEG-PARTIAL',null,'legacy-e2e-partial');
  if (select status from public.finance_credit_line_repayment_groups where id=v_first)<>'partially_paid'
     or (select remaining_amount from public.finance_credit_line_repayment_groups where id=v_first)<>30
     or (select used_amount from public.finance_credit_lines where id='58000000-0000-4000-8000-000000000011')<>90
     or (select balance from public.finance_cash_accounts where id='58000000-0000-4000-8000-000000000001')<>983 then
    raise exception 'ASSERT: partial cash repayment';
  end if;
  perform public.finance_create_credit_line_repayment_v2(
    '58000000-0000-4000-8000-000000000011',v_first,'58000000-0000-4000-8000-000000000001',30,3,1,current_date,'LEG-FULL',null,'legacy-e2e-full');
  if (select status from public.finance_credit_line_repayment_groups where id=v_first)<>'paid'
     or (select used_amount from public.finance_credit_lines where id='58000000-0000-4000-8000-000000000011')<>60
     or (select balance from public.finance_cash_accounts where id='58000000-0000-4000-8000-000000000001')<>949 then
    raise exception 'ASSERT: full cash repayment';
  end if;

  v_refi:=public.finance_refinance_credit_line(v_second,'58000000-0000-4000-8000-000000000012',current_date,60,4,2,null,'LEG-REFI',null,'legacy-e2e-refi');
  if (select status from public.finance_credit_line_repayment_groups where id=v_second)<>'paid'
     or (select used_amount from public.finance_credit_lines where id='58000000-0000-4000-8000-000000000011')<>0
     or (select used_amount from public.finance_credit_lines where id='58000000-0000-4000-8000-000000000012')<>66
     or not exists(select 1 from public.finance_credit_line_repayment_groups where id=(v_refi->>'funding_repayment_group_id')::uuid and group_origin_type='operational_cycle' and amount=66)
     or not exists(select 1 from public.finance_credit_line_refinancings where id=(v_refi->>'refinancing_id')::uuid and principal_eur=60 and interest_eur=4 and fees_eur=2) then
    raise exception 'ASSERT: legacy refinancing';
  end if;
end $$;

do $$ begin
  begin
    insert into public.finance_credit_line_planned_maturities(credit_line_id,due_date,planned_principal_eur,concept,source_type,source_key,status)
    values('58000000-0000-4000-8000-000000000011',current_date,1,'retired source','spreadsheet_schedule','legacy-e2e-sheet','planned');
    raise exception 'ASSERT: spreadsheet_schedule accepted';
  exception when others then if sqlerrm not like '%SPREADSHEET_SCHEDULE_RETIRED%' then raise; end if; end;
end $$;

select 'financial_legacy_end_to_end_test: OK' as result;
rollback;
