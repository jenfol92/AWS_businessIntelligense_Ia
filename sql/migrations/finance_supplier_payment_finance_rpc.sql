-- FASE FINANCE-SUPPLIER-PAYMENTS-FINANCE-RPC-1
-- RPC transaccional para registrar como se financio un pago proveedor.
-- No conecta endpoints, UI ni recalcula historicos.

create unique index if not exists ux_finance_cash_movements_supplier_payment_source
  on public.finance_cash_movements(movement_type, source_type, source_id)
  where source_type is not null
    and source_id is not null
    and movement_type = 'supplier_payment';

alter table public.finance_supplier_payments
  add column if not exists actual_amount_eur numeric(14, 2) null;

alter table public.finance_supplier_payments
  add column if not exists actual_amount_original numeric(14, 4) null;

alter table public.finance_supplier_payments
  add column if not exists bank_fee_eur numeric(14, 2) null;

alter table public.finance_supplier_payments
  add column if not exists ff_fee_eur numeric(14, 2) null;

create or replace function public.finance_finance_supplier_payment(
  p_supplier_payment_id uuid,
  p_source_type text,
  p_movement_date date,
  p_cash_account_id uuid default null,
  p_credit_line_id uuid default null,
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_payment public.finance_supplier_payments%rowtype;
  v_cash_account public.finance_cash_accounts%rowtype;
  v_cash_movement public.finance_cash_movements%rowtype;
  v_credit_line public.finance_credit_lines%rowtype;
  v_drawdown_result jsonb;
  v_credit_line_movement_id uuid;
  v_repayment_group_id uuid;
  v_legacy_payment_source text;
  v_payment_amount_eur numeric;
  v_notes text;
begin
  if p_supplier_payment_id is null then
    raise exception 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment id is required';
  end if;

  if p_source_type is null or p_source_type not in ('cash_account', 'credit_line') then
    raise exception 'INVALID_SOURCE_TYPE: source_type must be cash_account or credit_line';
  end if;

  if p_movement_date is null then
    raise exception 'INVALID_DATE: movement_date is required';
  end if;

  select *
  into v_payment
  from public.finance_supplier_payments
  where id = p_supplier_payment_id
  for update;

  if not found then
    raise exception 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found';
  end if;

  if v_payment.status <> 'pagado' or v_payment.paid_at is null then
    raise exception 'SUPPLIER_PAYMENT_NOT_PAID: supplier payment must be paid before financing';
  end if;

  v_payment_amount_eur :=
    coalesce(v_payment.actual_amount_eur, v_payment.amount_eur)
    + coalesce(v_payment.bank_fee_eur, 0)
    + coalesce(v_payment.ff_fee_eur, 0);

  if v_payment_amount_eur is null or v_payment_amount_eur <= 0 then
    raise exception 'INVALID_AMOUNT: supplier payment financed amount must be greater than 0';
  end if;

  if v_payment.payment_source_type is not null then
    if v_payment.payment_source_type = p_source_type
      and (
        (p_source_type = 'cash_account' and v_payment.cash_account_id = p_cash_account_id)
        or (p_source_type = 'credit_line' and v_payment.credit_line_id = p_credit_line_id)
      )
    then
      select *
      into v_cash_movement
      from public.finance_cash_movements
      where movement_type = 'supplier_payment'
        and source_type = 'supplier_payment'
        and source_id = v_payment.id
      limit 1;

      select m.id
      into v_credit_line_movement_id
      from public.finance_credit_line_movements m
      where m.credit_line_id = v_payment.credit_line_id
        and m.movement_type = 'drawdown'
        and m.source_type = 'supplier_payment'
        and m.source_id = v_payment.id
      limit 1;

      if v_credit_line_movement_id is not null then
        select repayment_group_id
        into v_repayment_group_id
        from public.finance_credit_line_movements
        where id = v_credit_line_movement_id;
      end if;

      return jsonb_build_object(
        'supplier_payment_id', v_payment.id,
        'source_type', v_payment.payment_source_type,
        'cash_account_id', v_payment.cash_account_id,
        'credit_line_id', v_payment.credit_line_id,
        'cash_movement_id', v_cash_movement.id,
        'credit_line_movement_id', v_credit_line_movement_id,
        'repayment_group_id', v_repayment_group_id,
        'amount_eur', v_payment_amount_eur,
        'idempotent', true
      );
    end if;

    raise exception 'ALREADY_FINANCED: supplier payment already has a different financing source';
  end if;

  v_notes := case
    when p_notes is not null and trim(p_notes) <> ''
      then concat_ws(E'\n', v_payment.notes, p_notes)
    else v_payment.notes
  end;

  if p_source_type = 'cash_account' then
    if p_cash_account_id is null then
      raise exception 'MISSING_CASH_ACCOUNT: cash_account_id is required';
    end if;

    select *
    into v_cash_account
    from public.finance_cash_accounts
    where id = p_cash_account_id
    for update;

    if not found then
      raise exception 'MISSING_CASH_ACCOUNT: cash account not found';
    end if;

    if v_cash_account.balance < v_payment_amount_eur then
      raise exception 'INSUFFICIENT_CASH: cash account balance is lower than supplier payment amount';
    end if;

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
      'supplier_payment',
      'out',
      v_payment_amount_eur,
      'supplier_payment',
      v_payment.id,
      p_movement_date,
      p_notes,
      now()
    )
    returning * into v_cash_movement;

    update public.finance_cash_accounts
    set
      balance = balance - v_payment_amount_eur,
      updated_at = now()
    where id = p_cash_account_id
    returning * into v_cash_account;

    update public.finance_supplier_payments
    set
      payment_source_type = 'cash_account',
      cash_account_id = p_cash_account_id,
      credit_line_id = null,
      payment_source = 'cash',
      notes = v_notes,
      updated_at = now()
    where id = v_payment.id
    returning * into v_payment;

    return jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'source_type', v_payment.payment_source_type,
      'cash_account_id', v_payment.cash_account_id,
      'credit_line_id', v_payment.credit_line_id,
      'cash_movement_id', v_cash_movement.id,
      'credit_line_movement_id', null,
      'repayment_group_id', null,
      'amount_eur', v_payment_amount_eur,
      'idempotent', false
    );
  end if;

  if p_source_type = 'credit_line' then
    if p_credit_line_id is null then
      raise exception 'MISSING_CREDIT_LINE: credit_line_id is required';
    end if;

    v_drawdown_result := public.finance_create_credit_line_drawdown(
      p_credit_line_id,
      v_payment_amount_eur,
      p_movement_date,
      'supplier_payment',
      v_payment.id,
      'Financiacion pago proveedor ' || v_payment.id::text,
      p_idempotency_key
    );

    v_credit_line_movement_id := (v_drawdown_result ->> 'movement_id')::uuid;
    v_repayment_group_id := (v_drawdown_result ->> 'repayment_group_id')::uuid;

    select *
    into v_credit_line
    from public.finance_credit_lines
    where id = p_credit_line_id;

    v_legacy_payment_source := case
      when lower(coalesce(v_credit_line.bank_name, '')) like '%rural%' then 'caja_rural'
      when lower(coalesce(v_credit_line.bank_name, '')) like '%caixa%' then 'la_caixa'
      when lower(coalesce(v_credit_line.bank_name, '')) like '%bbva%' then 'bbva'
      else null
    end;

    update public.finance_supplier_payments
    set
      payment_source_type = 'credit_line',
      cash_account_id = null,
      credit_line_id = p_credit_line_id,
      payment_source = v_legacy_payment_source,
      notes = v_notes,
      updated_at = now()
    where id = v_payment.id
    returning * into v_payment;

    return jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'source_type', v_payment.payment_source_type,
      'cash_account_id', v_payment.cash_account_id,
      'credit_line_id', v_payment.credit_line_id,
      'cash_movement_id', null,
      'credit_line_movement_id', v_credit_line_movement_id,
      'repayment_group_id', v_repayment_group_id,
      'amount_eur', v_payment_amount_eur,
      'idempotent', coalesce((v_drawdown_result ->> 'idempotent')::boolean, false)
    );
  end if;

  raise exception 'INVALID_SOURCE_TYPE: source_type must be cash_account or credit_line';
end;
$$;

comment on function public.finance_finance_supplier_payment(
  uuid,
  text,
  date,
  uuid,
  uuid,
  text,
  text
) is
  'Registra de forma transaccional como se financio un pago proveedor: caja o linea de credito.';
