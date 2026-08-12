-- Converts the 33 historical spreadsheet schedule rows into payable legacy debt.
-- The planned-maturity rows remain immutable evidence and are linked to the new groups.
-- This migration is intentionally transaction-neutral so it can be exercised inside
-- BEGIN/ROLLBACK and applied with psql --single-transaction.

do $$
declare
  v_line record;
  v_schedule record;
  v_regularization_id uuid;
  v_group_id uuid;
  v_item_id uuid;
  v_movement_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('finance:legacy-spreadsheet-conversion:v1', 0));

  if (
    select count(*)
    from public.finance_credit_lines
    where (id, credit_limit, used_amount, available_amount) in (
      ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid, 600000::numeric, 521500::numeric, 78500::numeric),
      ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid, 200000::numeric, 135000::numeric, 65000::numeric),
      ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid, 250000::numeric, 85000::numeric, 165000::numeric)
    )
  ) <> 3 then
    raise exception 'LEGACY_CONVERSION_LINE_PREFLIGHT_MISMATCH';
  end if;

  perform 1
  from public.finance_credit_lines
  where id in (
    '8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid,
    'a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid,
    'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid
  )
  order by id
  for update;

  if exists (
    select 1 from public.finance_credit_line_legacy_regularizations
    where credit_line_id in (
      '8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid,
      'a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid,
      'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid
    )
  ) or exists (
    select 1 from public.finance_credit_line_repayment_groups
    where credit_line_id in (
      '8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid,
      'a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid,
      'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid
    ) and status in ('open','partially_paid')
  ) then
    raise exception 'LEGACY_CONVERSION_ALREADY_STARTED';
  end if;

  if (
    select row(count(*), count(distinct source_key), coalesce(sum(planned_principal_eur), 0))
    from public.finance_credit_line_planned_maturities
    where source_type = 'spreadsheet_schedule'
      and status = 'planned'
      and linked_repayment_group_id is null
      and linked_repayment_id is null
  ) <> row(33::bigint, 33::bigint, 993229::numeric) then
    raise exception 'LEGACY_CONVERSION_SCHEDULE_PREFLIGHT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.finance_credit_line_planned_maturities
    where source_type = 'spreadsheet_schedule'
      and credit_line_id not in (
        '8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid,
        'a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid,
        'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid
      )
  ) then
    raise exception 'LEGACY_CONVERSION_UNEXPECTED_LINE';
  end if;

  if exists (
    select 1
    from (
      values
        ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid, 17::bigint, 588329::numeric),
        ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid, 7::bigint, 196000::numeric),
        ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid, 9::bigint, 208900::numeric)
    ) expected(credit_line_id, expected_count, expected_total)
    left join lateral (
      select count(*) as actual_count, coalesce(sum(planned_principal_eur), 0) as actual_total
      from public.finance_credit_line_planned_maturities pm
      where pm.credit_line_id = expected.credit_line_id
        and pm.source_type = 'spreadsheet_schedule'
        and pm.status = 'planned'
        and pm.linked_repayment_group_id is null
    ) actual on true
    where actual.actual_count <> expected.expected_count
       or actual.actual_total <> expected.expected_total
  ) then
    raise exception 'LEGACY_CONVERSION_LINE_SCHEDULE_MISMATCH';
  end if;

  update public.finance_credit_lines cl
  set used_amount = expected.used_amount,
      available_amount = cl.credit_limit - expected.used_amount,
      updated_at = now()
  from (values
    ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid, 588329::numeric),
    ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid, 196000::numeric),
    ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid, 208900::numeric)
  ) expected(id, used_amount)
  where cl.id = expected.id;

  for v_line in
    select * from (values
      ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid, 17::bigint, 588329::numeric),
      ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid, 7::bigint, 196000::numeric),
      ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid, 9::bigint, 208900::numeric)
    ) x(credit_line_id, item_count, total_eur)
  loop
    v_regularization_id := gen_random_uuid();
    insert into public.finance_credit_line_legacy_regularizations(
      id, credit_line_id, derived_gap_eur, declared_total_eur,
      idempotency_key, payload_fingerprint, created_by
    ) values (
      v_regularization_id, v_line.credit_line_id, v_line.total_eur, v_line.total_eur,
      'legacy-spreadsheet-conversion:v1:' || v_line.credit_line_id::text,
      'spreadsheet_schedule:v1:' || v_line.item_count::text || ':' || v_line.total_eur::text,
      null
    );

    for v_schedule in
      select pm.*
      from public.finance_credit_line_planned_maturities pm
      where pm.credit_line_id = v_line.credit_line_id
        and pm.source_type = 'spreadsheet_schedule'
        and pm.status = 'planned'
        and pm.linked_repayment_group_id is null
      order by pm.due_date, pm.source_key, pm.id
      for update
    loop
      v_group_id := gen_random_uuid();
      v_item_id := gen_random_uuid();
      v_movement_id := gen_random_uuid();

      insert into public.finance_credit_line_repayment_groups(
        id, credit_line_id, period_start, period_end, due_date,
        amount, paid_amount, remaining_amount, status,
        group_origin_type, group_origin_id
      ) values (
        v_group_id, v_line.credit_line_id, v_schedule.due_date, v_schedule.due_date,
        v_schedule.due_date, v_schedule.planned_principal_eur, 0,
        v_schedule.planned_principal_eur, 'open',
        'legacy_regularization', v_regularization_id
      );

      insert into public.finance_credit_line_movements(
        id, credit_line_id, movement_type, description, due_date, amount, status,
        source_type, source_id, movement_date, repayment_group_id, idempotency_key
      ) values (
        v_movement_id, v_line.credit_line_id, 'adjustment',
        'Deuda inicial legacy | ' || v_schedule.source_key,
        v_schedule.due_date, v_schedule.planned_principal_eur, 'posted',
        'legacy_opening_balance', v_item_id, least(v_schedule.due_date, current_date),
        v_group_id, 'legacy-spreadsheet-item:' || v_schedule.id::text
      );

      insert into public.finance_credit_line_legacy_regularization_items(
        id, regularization_id, credit_line_id, principal_eur,
        expected_interest_eur, expected_fees_eur, disposition_date,
        contractual_due_date, reference, notes,
        repayment_group_id, credit_line_movement_id
      ) values (
        v_item_id, v_regularization_id, v_line.credit_line_id,
        v_schedule.planned_principal_eur, v_schedule.expected_interest_eur,
        v_schedule.expected_fees_eur, null, v_schedule.due_date,
        v_schedule.source_key, v_schedule.notes,
        v_group_id, v_movement_id
      );

      update public.finance_credit_line_planned_maturities
      set linked_repayment_group_id = v_group_id,
          updated_at = now()
      where id = v_schedule.id
        and linked_repayment_group_id is null;

      if not found then
        raise exception 'LEGACY_CONVERSION_LINK_CONFLICT: %', v_schedule.source_key;
      end if;
    end loop;
  end loop;

  if (select count(*) from public.finance_credit_line_legacy_regularizations
      where idempotency_key like 'legacy-spreadsheet-conversion:v1:%') <> 3
     or (select count(*) from public.finance_credit_line_repayment_groups
         where group_origin_type = 'legacy_regularization'
           and group_origin_id in (
             select id from public.finance_credit_line_legacy_regularizations
             where idempotency_key like 'legacy-spreadsheet-conversion:v1:%'
           )) <> 33
     or (select count(*) from public.finance_credit_line_planned_maturities
         where source_type = 'spreadsheet_schedule'
           and linked_repayment_group_id is not null) <> 33 then
    raise exception 'LEGACY_CONVERSION_POSTCHECK_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.finance_credit_lines cl
    join (
      select credit_line_id, sum(remaining_amount) as remaining
      from public.finance_credit_line_repayment_groups
      where status in ('open','partially_paid')
      group by credit_line_id
    ) groups on groups.credit_line_id = cl.id
    where cl.id in (
      '8bb7c55d-0582-4c6f-a097-9ea4eea05bbe'::uuid,
      'a6dcc3a3-f065-47f5-a64b-9631af55e0bc'::uuid,
      'b24d9e3c-698c-4c14-bd1c-5c511b19e4d1'::uuid
    ) and (groups.remaining <> cl.used_amount
       or cl.available_amount <> cl.credit_limit - cl.used_amount
       or cl.used_amount < 0 or cl.available_amount < 0)
  ) then
    raise exception 'LEGACY_CONVERSION_POSTCHECK_BALANCE_MISMATCH';
  end if;
end $$;
