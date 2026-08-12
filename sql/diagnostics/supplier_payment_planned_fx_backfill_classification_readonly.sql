begin transaction read only;

with classified as (
  select p.id,p.orden_id,p.payment_type,p.status,p.original_currency,p.amount_original,p.amount_eur,
    p.planned_fx_rate,nullif(to_jsonb(p)->>'planned_fx_foreign_per_eur','')::numeric as planned_fx_foreign_per_eur,
    o.tipo_cambio_moneda_eur as legacy_order_fx,
    exists(select 1 from public.finance_purchase_payment_allocations a join public.finance_purchase_payment_batches b on b.id=a.batch_id where a.supplier_payment_id=p.id and b.status<>'reversed') as has_allocations,
    (p.status in ('parcial','pagado') or p.paid_at is not null or p.actual_amount_original is not null or p.actual_amount_eur is not null or exists(select 1 from public.finance_purchase_payment_allocations a where a.supplier_payment_id=p.id)) as has_execution
  from public.finance_supplier_payments p join public.ordenes_compra o on o.id=p.orden_id
), grouped as (
  select *,case
    when has_execution then 'D'
    when upper(original_currency)='EUR' then 'A'
    when legacy_order_fx is not null and legacy_order_fx>0 then 'B_CANDIDATE_REQUIRES_PROVENANCE'
    else 'C' end as backfill_group
  from classified
)
select *,count(*) over(partition by backfill_group) as group_rows,
  sum(amount_original) over(partition by backfill_group) as group_amount_original,
  count(*) filter(where planned_fx_foreign_per_eur is null) over(partition by backfill_group) as group_missing_new_fx,
  count(*) filter(where amount_eur=0 and upper(original_currency)<>'EUR') over(partition by backfill_group) as group_silent_zero_rows
from grouped order by backfill_group,orden_id,payment_type;

rollback;
