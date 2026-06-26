-- FASE FINANCE-CREDIT-LINES-RPC-1
-- RPC transaccionales para disposiciones y devoluciones de lineas de credito.
-- No conecta endpoints, UI ni recalcula historicos.

create or replace function public.finance_create_credit_line_drawdown(
  p_credit_line_id uuid,
  p_amount numeric,
  p_movement_date date,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_line public.finance_credit_lines%rowtype;
  v_group public.finance_credit_line_repayment_groups%rowtype;
  v_existing public.finance_credit_line_movements%rowtype;
  v_movement public.finance_credit_line_movements%rowtype;
  v_period_end date;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: amount must be greater than 0';
  end if;

  if p_movement_date is null then
    raise exception 'INVALID_DATE: movement_date is required';
  end if;

  select *
  into v_line
  from public.finance_credit_lines
  where id = p_credit_line_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: credit line not found';
  end if;

  if p_idempotency_key is not null then
    select *
    into v_existing
    from public.finance_credit_line_movements
    where idempotency_key = p_idempotency_key
      and movement_type = 'drawdown'
    limit 1;

    if found then
      return jsonb_build_object(
        'movement_id', v_existing.id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'idempotent', true
      );
    end if;
  end if;

  if p_source_type is not null and p_source_id is not null then
    select *
    into v_existing
    from public.finance_credit_line_movements
    where credit_line_id = p_credit_line_id
      and movement_type = 'drawdown'
      and source_type = p_source_type
      and source_id = p_source_id
    limit 1;

    if found then
      return jsonb_build_object(
        'movement_id', v_existing.id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'idempotent', true
      );
    end if;
  end if;

  if v_line.available_amount < p_amount then
    raise exception 'INSUFFICIENT_CREDIT: available_amount is lower than amount';
  end if;

  if v_line.used_amount + p_amount > v_line.credit_limit then
    raise exception 'INSUFFICIENT_CREDIT: used_amount would exceed credit_limit';
  end if;

  select *
  into v_group
  from public.finance_credit_line_repayment_groups
  where credit_line_id = p_credit_line_id
    and status in ('open', 'partially_paid')
    and p_movement_date between period_start and period_end
  order by period_start
  limit 1
  for update;

  if not found then
    if v_line.cycle_days is null then
      raise exception 'MANUAL_DUE_DATE_REQUIRED: credit line has no cycle_days';
    end if;

    v_period_end := p_movement_date + v_line.cycle_days;

    insert into public.finance_credit_line_repayment_groups (
      credit_line_id,
      period_start,
      period_end,
      due_date,
      amount,
      paid_amount,
      remaining_amount,
      status,
      updated_at
    )
    values (
      p_credit_line_id,
      p_movement_date,
      v_period_end,
      v_period_end,
      0,
      0,
      0,
      'open',
      now()
    )
    returning * into v_group;
  end if;

  insert into public.finance_credit_line_movements (
    credit_line_id,
    movement_type,
    description,
    due_date,
    paid_at,
    amount,
    status,
    source_type,
    source_id,
    movement_date,
    repayment_group_id,
    idempotency_key,
    updated_at
  )
  values (
    p_credit_line_id,
    'drawdown',
    coalesce(nullif(trim(p_description), ''), 'Disposicion linea de credito'),
    v_group.due_date,
    null,
    p_amount,
    'posted',
    p_source_type,
    p_source_id,
    p_movement_date,
    v_group.id,
    p_idempotency_key,
    now()
  )
  returning * into v_movement;

  update public.finance_credit_line_repayment_groups
  set
    amount = amount + p_amount,
    remaining_amount = amount + p_amount - paid_amount,
    updated_at = now()
  where id = v_group.id
  returning * into v_group;

  update public.finance_credit_lines
  set
    used_amount = used_amount + p_amount,
    available_amount = available_amount - p_amount,
    updated_at = now()
  where id = p_credit_line_id
  returning * into v_line;

  return jsonb_build_object(
    'movement_id', v_movement.id,
    'repayment_group_id', v_group.id,
    'credit_line_id', v_line.id,
    'used_amount', v_line.used_amount,
    'available_amount', v_line.available_amount,
    'idempotent', false
  );
end;
$$;

create or replace function public.finance_create_credit_line_repayment(
  p_credit_line_id uuid,
  p_amount numeric,
  p_movement_date date,
  p_cash_account_id uuid,
  p_repayment_group_id uuid default null,
  p_source_type text default 'manual_repayment',
  p_source_id uuid default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_line public.finance_credit_lines%rowtype;
  v_cash_account public.finance_cash_accounts%rowtype;
  v_group public.finance_credit_line_repayment_groups%rowtype;
  v_existing public.finance_credit_line_movements%rowtype;
  v_movement public.finance_credit_line_movements%rowtype;
  v_cash_movement public.finance_cash_movements%rowtype;
  v_next_remaining numeric;
  v_next_paid numeric;
  v_next_status text;
  v_paid_at timestamptz;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: amount must be greater than 0';
  end if;

  if p_movement_date is null then
    raise exception 'INVALID_DATE: movement_date is required';
  end if;

  select *
  into v_line
  from public.finance_credit_lines
  where id = p_credit_line_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: credit line not found';
  end if;

  select *
  into v_cash_account
  from public.finance_cash_accounts
  where id = p_cash_account_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: cash account not found';
  end if;

  if p_idempotency_key is not null then
    select *
    into v_existing
    from public.finance_credit_line_movements
    where idempotency_key = p_idempotency_key
      and movement_type = 'repayment'
    limit 1;

    if found then
      return jsonb_build_object(
        'movement_id', v_existing.id,
        'cash_movement_id', v_existing.cash_movement_id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'cash_account_id', v_cash_account.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'cash_balance', v_cash_account.balance,
        'idempotent', true
      );
    end if;
  end if;

  if p_source_type is not null and p_source_id is not null then
    select *
    into v_existing
    from public.finance_credit_line_movements
    where credit_line_id = p_credit_line_id
      and movement_type = 'repayment'
      and source_type = p_source_type
      and source_id = p_source_id
    limit 1;

    if found then
      return jsonb_build_object(
        'movement_id', v_existing.id,
        'cash_movement_id', v_existing.cash_movement_id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'cash_account_id', v_cash_account.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'cash_balance', v_cash_account.balance,
        'idempotent', true
      );
    end if;
  end if;

  if v_line.used_amount < p_amount then
    raise exception 'INSUFFICIENT_USED_AMOUNT: repayment exceeds used_amount';
  end if;

  if v_line.available_amount + p_amount > v_line.credit_limit then
    raise exception 'INSUFFICIENT_CREDIT: available_amount would exceed credit_limit';
  end if;

  if v_cash_account.balance < p_amount then
    raise exception 'INSUFFICIENT_CASH: cash account balance is lower than amount';
  end if;

  if p_repayment_group_id is not null then
    select *
    into v_group
    from public.finance_credit_line_repayment_groups
    where id = p_repayment_group_id
    for update;

    if not found then
      raise exception 'NOT_FOUND: repayment group not found';
    end if;

    if v_group.credit_line_id <> p_credit_line_id then
      raise exception 'GROUP_MISMATCH: repayment group does not belong to credit line';
    end if;

    if v_group.remaining_amount < p_amount then
      raise exception 'INSUFFICIENT_USED_AMOUNT: repayment exceeds group remaining_amount';
    end if;
  end if;

  insert into public.finance_credit_line_movements (
    credit_line_id,
    movement_type,
    description,
    due_date,
    paid_at,
    amount,
    status,
    source_type,
    source_id,
    movement_date,
    repayment_group_id,
    idempotency_key,
    updated_at
  )
  values (
    p_credit_line_id,
    'repayment',
    coalesce(nullif(trim(p_notes), ''), 'Devolucion linea de credito'),
    p_movement_date,
    p_movement_date::timestamptz,
    p_amount,
    'pagado',
    p_source_type,
    p_source_id,
    p_movement_date,
    p_repayment_group_id,
    p_idempotency_key,
    now()
  )
  returning * into v_movement;

  insert into public.finance_cash_movements (
    cash_account_id,
    movement_type,
    direction,
    amount,
    source_type,
    source_id,
    movement_date,
    notes,
    updated_at
  )
  values (
    p_cash_account_id,
    'credit_repayment',
    'out',
    p_amount,
    'credit_line_movement',
    v_movement.id,
    p_movement_date,
    p_notes,
    now()
  )
  returning * into v_cash_movement;

  update public.finance_credit_line_movements
  set
    cash_movement_id = v_cash_movement.id,
    updated_at = now()
  where id = v_movement.id
  returning * into v_movement;

  update public.finance_credit_lines
  set
    used_amount = used_amount - p_amount,
    available_amount = available_amount + p_amount,
    updated_at = now()
  where id = p_credit_line_id
  returning * into v_line;

  update public.finance_cash_accounts
  set
    balance = balance - p_amount,
    updated_at = now()
  where id = p_cash_account_id
  returning * into v_cash_account;

  if p_repayment_group_id is not null then
    v_next_paid := v_group.paid_amount + p_amount;
    v_next_remaining := v_group.remaining_amount - p_amount;
    v_next_status := case when v_next_remaining = 0 then 'paid' else 'partially_paid' end;
    v_paid_at := case when v_next_status = 'paid' then p_movement_date::timestamptz else null end;

    update public.finance_credit_line_repayment_groups
    set
      paid_amount = v_next_paid,
      remaining_amount = v_next_remaining,
      status = v_next_status,
      paid_at = v_paid_at,
      updated_at = now()
    where id = p_repayment_group_id
    returning * into v_group;
  end if;

  return jsonb_build_object(
    'movement_id', v_movement.id,
    'cash_movement_id', v_cash_movement.id,
    'repayment_group_id', p_repayment_group_id,
    'credit_line_id', v_line.id,
    'cash_account_id', v_cash_account.id,
    'used_amount', v_line.used_amount,
    'available_amount', v_line.available_amount,
    'cash_balance', v_cash_account.balance,
    'idempotent', false
  );
end;
$$;

comment on function public.finance_create_credit_line_drawdown(
  uuid,
  numeric,
  date,
  text,
  uuid,
  text,
  text
) is
  'Crea una disposicion de linea de credito de forma transaccional e idempotente.';

comment on function public.finance_create_credit_line_repayment(
  uuid,
  numeric,
  date,
  uuid,
  uuid,
  text,
  uuid,
  text,
  text
) is
  'Crea una devolucion de linea de credito con salida de caja de forma transaccional e idempotente.';
