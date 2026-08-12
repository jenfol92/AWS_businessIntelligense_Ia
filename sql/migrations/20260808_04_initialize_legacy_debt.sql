-- Direct, idempotent initialization of the immutable 2026 legacy opening debt.
--
-- The canonical opening dataset is deliberately embedded below. Keeping it in
-- this migration makes execution reproducible in every PostgreSQL client: an
-- external data file would require client-specific \i paths and would no longer
-- be an atomic, self-contained Supabase migration.
--
-- This migration is transaction-neutral. Execute it with psql
-- --single-transaction, or wrap it in BEGIN/ROLLBACK for the rehearsal.

create temporary table finance_legacy_opening_lines_v1 (
  credit_line_id uuid primary key,
  bank_name text not null,
  line_name text not null,
  credit_limit numeric(14,2) not null,
  prior_used_amount numeric(14,2) not null,
  prior_available_amount numeric(14,2) not null,
  opening_used_amount numeric(14,2) not null,
  opening_available_amount numeric(14,2) not null,
  expected_items integer not null
) on commit drop;

insert into finance_legacy_opening_lines_v1 values
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','Caja Rural','Credito Global',600000,521500,78500,588329,11671,17),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','La Caixa','Credito Global',200000,135000,65000,196000,4000,7),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','BBVA','Lineas Consolidadas',250000,85000,165000,208900,41100,9);

-- Immutable canonical opening dataset v1: 33 contractual legacy instalments.
create temporary table finance_legacy_opening_items_v1 (
  credit_line_id uuid not null,
  due_date date not null,
  principal_eur numeric(14,2) not null,
  source_key text primary key,
  historical_reference text null
) on commit drop;

insert into finance_legacy_opening_items_v1 values
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-03',22000,'credit-maturity:caja-rural:2026-08-03:22000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-10',27800,'credit-maturity:caja-rural:2026-08-10:27800.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-14',50000,'credit-maturity:caja-rural:2026-08-14:50000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-20',20000,'credit-maturity:caja-rural:2026-08-20:20000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-20',26000,'credit-maturity:caja-rural:2026-08-20:26000.00:2','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-08-27',40000,'credit-maturity:caja-rural:2026-08-27:40000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-05',54700,'credit-maturity:caja-rural:2026-09-05:54700.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-14',21400,'credit-maturity:caja-rural:2026-09-14:21400.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-15',15829,'credit-maturity:caja-rural:2026-09-15:15829.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-09-25',28000,'credit-maturity:caja-rural:2026-09-25:28000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-02',68000,'credit-maturity:caja-rural:2026-10-02:68000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-06',35000,'credit-maturity:caja-rural:2026-10-06:35000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-15',40000,'credit-maturity:caja-rural:2026-10-15:40000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-10-23',37100,'credit-maturity:caja-rural:2026-10-23:37100.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-02',21500,'credit-maturity:caja-rural:2026-11-02:21500.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-06',40000,'credit-maturity:caja-rural:2026-11-06:40000.00:1','Calendario líneas bancarias 2026'),
  ('8bb7c55d-0582-4c6f-a097-9ea4eea05bbe','2026-11-10',41000,'credit-maturity:caja-rural:2026-11-10:41000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-18',25000,'credit-maturity:la-caixa:2026-08-18:25000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-21',20000,'credit-maturity:la-caixa:2026-08-21:20000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-24',24000,'credit-maturity:la-caixa:2026-08-24:24000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-08-25',40000,'credit-maturity:la-caixa:2026-08-25:40000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-09-04',30000,'credit-maturity:la-caixa:2026-09-04:30000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-10-09',30000,'credit-maturity:la-caixa:2026-10-09:30000.00:1','Calendario líneas bancarias 2026'),
  ('a6dcc3a3-f065-47f5-a64b-9631af55e0bc','2026-10-19',27000,'credit-maturity:la-caixa:2026-10-19:27000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-28',44000,'credit-maturity:bbva:2026-07-28:44000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-28',8300,'credit-maturity:bbva:2026-07-28:8300.00:2','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-07-31',8300,'credit-maturity:bbva:2026-07-31:8300.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-08-17',6000,'credit-maturity:bbva:2026-08-17:6000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-08-28',8300,'credit-maturity:bbva:2026-08-28:8300.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-02',60000,'credit-maturity:bbva:2026-09-02:60000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-07',40000,'credit-maturity:bbva:2026-09-07:40000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-09-23',17000,'credit-maturity:bbva:2026-09-23:17000.00:1','Calendario líneas bancarias 2026'),
  ('b24d9e3c-698c-4c14-bd1c-5c511b19e4d1','2026-10-23',17000,'credit-maturity:bbva:2026-10-23:17000.00:1','Calendario líneas bancarias 2026');

do $$
declare
  v_line record;
  v_item record;
  v_regularization_id uuid;
  v_group_id uuid;
  v_item_id uuid;
  v_movement_id uuid;
  v_legacy_regularizations bigint;
  v_legacy_items bigint;
  v_legacy_groups bigint;
  v_legacy_movements bigint;
  v_mode text;
begin
  perform pg_advisory_xact_lock(hashtextextended('finance:legacy-direct-initialization:v1',0));

  if (select row(count(*),count(distinct source_key),coalesce(sum(principal_eur),0))
      from finance_legacy_opening_items_v1)
      <> row(33::bigint,33::bigint,993229::numeric) then
    raise exception 'LEGACY_INITIALIZATION_CANONICAL_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1
    from finance_legacy_opening_lines_v1 expected
    left join lateral (
      select count(*) item_count,coalesce(sum(principal_eur),0) item_total
      from finance_legacy_opening_items_v1 item
      where item.credit_line_id=expected.credit_line_id
    ) actual on true
    where actual.item_count<>expected.expected_items
       or actual.item_total<>expected.opening_used_amount
       or expected.opening_available_amount<>expected.credit_limit-expected.opening_used_amount
  ) then
    raise exception 'LEGACY_INITIALIZATION_CANONICAL_LINE_MISMATCH';
  end if;

  perform 1
  from public.finance_credit_lines cl
  join finance_legacy_opening_lines_v1 expected on expected.credit_line_id=cl.id
  order by cl.id
  for update of cl;

  if (select count(*) from public.finance_credit_lines cl
      join finance_legacy_opening_lines_v1 expected on expected.credit_line_id=cl.id
      where cl.bank_name=expected.bank_name
        and cl.line_name=expected.line_name
        and cl.credit_limit=expected.credit_limit)<>3 then
    raise exception 'LEGACY_INITIALIZATION_LINE_IDENTITY_MISMATCH';
  end if;

  select count(*) into v_legacy_regularizations
  from public.finance_credit_line_legacy_regularizations r
  where r.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1);

  select count(*) into v_legacy_items
  from public.finance_credit_line_legacy_regularization_items i
  where i.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1);

  select count(*) into v_legacy_groups
  from public.finance_credit_line_repayment_groups g
  where g.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
    and g.group_origin_type='legacy_regularization';

  select count(*) into v_legacy_movements
  from public.finance_credit_line_movements m
  where m.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
    and m.source_type='legacy_opening_balance';

  if v_legacy_regularizations=0 and v_legacy_items=0 and v_legacy_groups=0 and v_legacy_movements=0 then
    if (select count(*) from public.finance_credit_lines cl
        join finance_legacy_opening_lines_v1 expected on expected.credit_line_id=cl.id
        where cl.used_amount=expected.prior_used_amount
          and cl.available_amount=expected.prior_available_amount)<>3
       or exists (
         select 1 from public.finance_credit_line_repayment_groups g
         where g.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
           and g.status in ('open','partially_paid')
       ) then
      raise exception 'LEGACY_INITIALIZATION_PRIOR_STATE_MISMATCH';
    end if;
    v_mode:='initialize';
  elsif v_legacy_regularizations=3 and v_legacy_items=33 and v_legacy_groups=33 and v_legacy_movements=33 then
    v_mode:='validate';
  else
    raise exception 'LEGACY_INITIALIZATION_PARTIAL_OR_INCOMPATIBLE';
  end if;

  if v_mode='initialize' then
    update public.finance_credit_lines cl
    set used_amount=expected.opening_used_amount,
        available_amount=expected.opening_available_amount,
        updated_at=now()
    from finance_legacy_opening_lines_v1 expected
    where cl.id=expected.credit_line_id;

    for v_line in select * from finance_legacy_opening_lines_v1 order by credit_line_id loop
      v_regularization_id:=gen_random_uuid();

      insert into public.finance_credit_line_legacy_regularizations(
        id,credit_line_id,derived_gap_eur,declared_total_eur,
        idempotency_key,payload_fingerprint,created_by
      ) values (
        v_regularization_id,v_line.credit_line_id,v_line.opening_used_amount,
        v_line.opening_used_amount,
        'legacy-direct-initialization:v1:'||v_line.credit_line_id::text,
        'legacy-opening:v1:'||v_line.expected_items::text||':'||v_line.opening_used_amount::text,
        null
      );

      for v_item in
        select * from finance_legacy_opening_items_v1
        where credit_line_id=v_line.credit_line_id
        order by due_date,source_key
      loop
        v_group_id:=gen_random_uuid();
        v_item_id:=gen_random_uuid();
        v_movement_id:=gen_random_uuid();

        insert into public.finance_credit_line_repayment_groups(
          id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,
          remaining_amount,status,group_origin_type,group_origin_id
        ) values (
          v_group_id,v_line.credit_line_id,v_item.due_date,v_item.due_date,
          v_item.due_date,v_item.principal_eur,0,v_item.principal_eur,'open',
          'legacy_regularization',v_regularization_id
        );

        insert into public.finance_credit_line_movements(
          id,credit_line_id,movement_type,description,due_date,amount,status,
          source_type,source_id,movement_date,repayment_group_id,idempotency_key
        ) values (
          v_movement_id,v_line.credit_line_id,'adjustment',
          'Deuda inicial legacy | '||v_item.source_key,v_item.due_date,
          v_item.principal_eur,'posted','legacy_opening_balance',v_item_id,
          least(v_item.due_date,current_date),v_group_id,
          'legacy-opening-source:'||v_item.source_key
        );

        insert into public.finance_credit_line_legacy_regularization_items(
          id,regularization_id,credit_line_id,principal_eur,
          expected_interest_eur,expected_fees_eur,disposition_date,
          contractual_due_date,reference,notes,repayment_group_id,
          credit_line_movement_id
        ) values (
          v_item_id,v_regularization_id,v_line.credit_line_id,v_item.principal_eur,
          0,0,null,v_item.due_date,v_item.source_key,
          case when v_item.historical_reference is null then null
               else 'Referencia histórica: '||v_item.historical_reference end,
          v_group_id,v_movement_id
        );
      end loop;
    end loop;
  end if;

  -- Common exact-state validation: this also makes a second execution a no-op.
  if (select count(*) from public.finance_credit_line_legacy_regularizations r
      where r.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1))<>3
     or (select count(*) from public.finance_credit_line_legacy_regularization_items i
         where i.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1))<>33
     or (select count(*) from public.finance_credit_line_repayment_groups g
         where g.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
           and g.group_origin_type='legacy_regularization')<>33
     or (select count(*) from public.finance_credit_line_movements m
         where m.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
           and m.source_type='legacy_opening_balance')<>33 then
    raise exception 'LEGACY_INITIALIZATION_POSTCHECK_COUNT_MISMATCH';
  end if;

  if exists (
    select 1
    from finance_legacy_opening_lines_v1 expected
    left join lateral (
      select count(*) regularization_count
      from public.finance_credit_line_legacy_regularizations r
      where r.credit_line_id=expected.credit_line_id
        and r.derived_gap_eur=expected.opening_used_amount
        and r.declared_total_eur=expected.opening_used_amount
    ) actual on true
    where actual.regularization_count<>1
  ) then
    raise exception 'LEGACY_INITIALIZATION_POSTCHECK_REGULARIZATION_MISMATCH';
  end if;

  if exists (
    select 1
    from finance_legacy_opening_items_v1 expected
    left join public.finance_credit_line_legacy_regularization_items i
      on i.credit_line_id=expected.credit_line_id and i.reference=expected.source_key
    left join public.finance_credit_line_legacy_regularizations r
      on r.id=i.regularization_id
    left join public.finance_credit_line_repayment_groups g
      on g.id=i.repayment_group_id
    left join public.finance_credit_line_movements m
      on m.id=i.credit_line_movement_id
    where i.id is null
       or i.principal_eur<>expected.principal_eur
       or i.contractual_due_date<>expected.due_date
       or coalesce(i.expected_interest_eur,0)<>0
       or coalesce(i.expected_fees_eur,0)<>0
       or r.id is null
       or r.credit_line_id<>expected.credit_line_id
       or g.id is null
       or g.credit_line_id<>expected.credit_line_id
       or g.due_date<>expected.due_date
       or g.amount<>expected.principal_eur
       or g.paid_amount<>0
       or g.remaining_amount<>expected.principal_eur
       or g.status<>'open'
       or g.group_origin_type<>'legacy_regularization'
       or g.group_origin_id<>r.id
       or m.id is null
       or m.credit_line_id<>expected.credit_line_id
       or m.movement_type<>'adjustment'
       or m.amount<>expected.principal_eur
       or m.status<>'posted'
       or m.source_type<>'legacy_opening_balance'
       or m.source_id<>i.id
       or m.repayment_group_id<>g.id
  ) then
    raise exception 'LEGACY_INITIALIZATION_POSTCHECK_ITEM_MISMATCH';
  end if;

  if exists (
    select i.reference
    from public.finance_credit_line_legacy_regularization_items i
    where i.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
    group by i.reference having count(*)<>1
  ) or exists (
    select i.repayment_group_id
    from public.finance_credit_line_legacy_regularization_items i
    where i.credit_line_id in (select credit_line_id from finance_legacy_opening_lines_v1)
    group by i.repayment_group_id having count(*)<>1
  ) then
    raise exception 'LEGACY_INITIALIZATION_POSTCHECK_DUPLICATE';
  end if;

  if exists (
    select 1
    from finance_legacy_opening_lines_v1 expected
    join public.finance_credit_lines cl on cl.id=expected.credit_line_id
    left join lateral (
      select count(*) item_count,coalesce(sum(g.remaining_amount),0) remaining
      from public.finance_credit_line_repayment_groups g
      where g.credit_line_id=expected.credit_line_id
        and g.status in ('open','partially_paid')
    ) actual on true
    where cl.used_amount<>expected.opening_used_amount
       or cl.available_amount<>expected.opening_available_amount
       or cl.available_amount<>cl.credit_limit-cl.used_amount
       or actual.item_count<>expected.expected_items
       or actual.remaining<>cl.used_amount
       or cl.used_amount<0 or cl.available_amount<0 or actual.remaining<0
  ) then
    raise exception 'LEGACY_INITIALIZATION_POSTCHECK_BALANCE_MISMATCH';
  end if;
end $$;
