-- READ-ONLY diagnostic: credit line maturities / ledger consistency.
-- Do not run mutators. Safe for test DB.

-- 1. Lines
SELECT
  id,
  bank_name,
  line_name,
  credit_limit,
  used_amount,
  available_amount,
  status,
  repayment_mode,
  cycle_days,
  maturity_date,
  priority
FROM public.finance_credit_lines
ORDER BY priority NULLS LAST, bank_name, line_name;

-- 2. Drawdowns
SELECT
  m.id,
  m.credit_line_id,
  cl.bank_name,
  cl.line_name,
  m.amount,
  m.movement_date,
  m.source_type,
  m.source_id,
  m.repayment_group_id,
  m.idempotency_key,
  m.created_at
FROM public.finance_credit_line_movements m
JOIN public.finance_credit_lines cl ON cl.id = m.credit_line_id
WHERE m.movement_type = 'drawdown'
ORDER BY m.movement_date DESC NULLS LAST, m.created_at DESC;

-- 3. Repayments
SELECT
  m.id,
  m.credit_line_id,
  cl.bank_name,
  cl.line_name,
  m.amount,
  m.movement_date,
  m.repayment_group_id,
  m.cash_movement_id,
  m.idempotency_key,
  m.created_at
FROM public.finance_credit_line_movements m
JOIN public.finance_credit_lines cl ON cl.id = m.credit_line_id
WHERE m.movement_type = 'repayment'
ORDER BY m.movement_date DESC NULLS LAST, m.created_at DESC;

-- 4. Repayment groups
SELECT
  g.id,
  g.credit_line_id,
  cl.bank_name,
  cl.line_name,
  g.amount,
  g.paid_amount,
  g.remaining_amount,
  g.due_date,
  g.status,
  g.period_start,
  g.period_end,
  g.created_at,
  g.updated_at
FROM public.finance_credit_line_repayment_groups g
JOIN public.finance_credit_lines cl ON cl.id = g.credit_line_id
ORDER BY g.due_date NULLS LAST, g.created_at;

-- 5. Open / partially_paid groups
SELECT *
FROM public.finance_credit_line_repayment_groups
WHERE status IN ('open', 'partially_paid')
ORDER BY due_date;

-- 6. Orphan drawdowns
SELECT m.*
FROM public.finance_credit_line_movements m
WHERE m.movement_type = 'drawdown'
  AND m.repayment_group_id IS NULL;

-- 7. Lines with used_amount but no open groups
SELECT
  cl.id,
  cl.bank_name,
  cl.line_name,
  cl.used_amount,
  COALESCE(g.open_remaining, 0) AS open_group_remaining,
  COALESCE(m.drawdown_sum, 0) - COALESCE(m.repay_sum, 0) AS ledger_net
FROM public.finance_credit_lines cl
LEFT JOIN LATERAL (
  SELECT SUM(remaining_amount) AS open_remaining
  FROM public.finance_credit_line_repayment_groups g
  WHERE g.credit_line_id = cl.id
    AND g.status IN ('open', 'partially_paid')
) g ON true
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN movement_type = 'drawdown' THEN amount ELSE 0 END) AS drawdown_sum,
    SUM(CASE WHEN movement_type = 'repayment' THEN amount ELSE 0 END) AS repay_sum
  FROM public.finance_credit_line_movements m
  WHERE m.credit_line_id = cl.id
) m ON true
WHERE cl.used_amount > 0.01
  AND COALESCE(g.open_remaining, 0) <= 0.01;

-- 8. Classification per line
WITH ledger AS (
  SELECT
    credit_line_id,
    SUM(CASE WHEN movement_type = 'drawdown' THEN amount ELSE 0 END) AS draws,
    SUM(CASE WHEN movement_type = 'repayment' THEN amount ELSE 0 END) AS repays,
    SUM(CASE WHEN movement_type = 'drawdown' AND repayment_group_id IS NULL THEN amount ELSE 0 END) AS orphan_draws
  FROM public.finance_credit_line_movements
  GROUP BY credit_line_id
),
groups AS (
  SELECT
    credit_line_id,
    SUM(CASE WHEN status IN ('open', 'partially_paid') THEN remaining_amount ELSE 0 END) AS open_remaining,
    SUM(amount - paid_amount) FILTER (WHERE status <> 'cancelled') AS group_net_debt,
    COUNT(*) FILTER (WHERE status IN ('open', 'partially_paid')) AS open_groups
  FROM public.finance_credit_line_repayment_groups
  GROUP BY credit_line_id
)
SELECT
  cl.id,
  cl.bank_name,
  cl.line_name,
  cl.used_amount,
  cl.available_amount,
  cl.cycle_days,
  COALESCE(l.draws, 0) AS drawdown_sum,
  COALESCE(l.repays, 0) AS repayment_sum,
  COALESCE(l.draws, 0) - COALESCE(l.repays, 0) AS ledger_net,
  COALESCE(g.open_remaining, 0) AS open_group_remaining,
  COALESCE(l.orphan_draws, 0) AS orphan_drawdown_amount,
  CASE
    WHEN cl.cycle_days IS NULL THEN 'MANUAL_DUE_DATE_REQUIRED'
    WHEN COALESCE(l.orphan_draws, 0) > 0.01 THEN 'ORPHAN_DRAWDOWN'
    WHEN cl.used_amount > 0.01
      AND ABS(cl.used_amount - (COALESCE(l.draws, 0) - COALESCE(l.repays, 0))) > 0.01
      AND COALESCE(l.draws, 0) = 0
      THEN 'LEGACY_OPENING_BALANCE'
    WHEN cl.used_amount > 0.01
      AND COALESCE(l.draws, 0) = 0
      AND COALESCE(g.open_remaining, 0) = 0
      THEN 'LEGACY_OPENING_BALANCE'
    WHEN ABS((COALESCE(l.draws, 0) - COALESCE(l.repays, 0)) - COALESCE(g.open_remaining, 0)) > 0.01
      AND COALESCE(g.open_groups, 0) > 0
      THEN 'GROUP_MISMATCH'
    WHEN ABS(cl.used_amount - (COALESCE(l.draws, 0) - COALESCE(l.repays, 0))) > 0.01
      AND COALESCE(l.draws, 0) > 0
      THEN 'GROUP_MISMATCH'
    ELSE 'CONSISTENT'
  END AS classification
FROM public.finance_credit_lines cl
LEFT JOIN ledger l ON l.credit_line_id = cl.id
LEFT JOIN groups g ON g.credit_line_id = cl.id
ORDER BY cl.priority NULLS LAST, cl.bank_name, cl.line_name;

-- 9. Lines with cycle_days null
SELECT id, bank_name, line_name, used_amount, cycle_days, repayment_mode
FROM public.finance_credit_lines
WHERE cycle_days IS NULL;

-- 10. Open maturities outside next 6 months
SELECT
  g.id,
  cl.bank_name,
  cl.line_name,
  g.due_date,
  g.remaining_amount,
  g.status,
  CASE
    WHEN g.due_date < CURRENT_DATE THEN 'overdue'
    WHEN g.due_date > (date_trunc('month', CURRENT_DATE) + interval '6 months' - interval '1 day')::date
      THEN 'outside_six_month_horizon'
    ELSE 'inside_horizon'
  END AS visibility_bucket
FROM public.finance_credit_line_repayment_groups g
JOIN public.finance_credit_lines cl ON cl.id = g.credit_line_id
WHERE g.status IN ('open', 'partially_paid')
  AND g.remaining_amount > 0
ORDER BY g.due_date;
