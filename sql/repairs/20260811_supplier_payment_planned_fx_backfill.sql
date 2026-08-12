begin;

-- Debe rellenarse manualmente tras revisar el diagnóstico READ ONLY. Vacía por diseño.
create temporary table approved_legacy_order_fx(order_id uuid primary key) on commit drop;

-- Grupo A: EUR sin ejecución.
update public.finance_supplier_payments p set
  planned_fx_foreign_per_eur=1,amount_eur=round(p.amount_original,4),planned_fx_regularization_status='complete',updated_at=now()
where upper(p.original_currency)='EUR' and p.planned_fx_foreign_per_eur is null
  and p.status not in ('parcial','pagado') and p.paid_at is null and p.actual_amount_original is null and p.actual_amount_eur is null
  and not exists(select 1 from public.finance_purchase_payment_allocations a where a.supplier_payment_id=p.id);

-- Grupo B: solo órdenes aprobadas explícitamente después de verificar procedencia del FX legacy.
update public.finance_supplier_payments p set
  planned_fx_foreign_per_eur=1/o.tipo_cambio_moneda_eur,
  amount_eur=round(p.amount_original*o.tipo_cambio_moneda_eur,4),
  planned_fx_regularization_status='complete',updated_at=now()
from public.ordenes_compra o join approved_legacy_order_fx approved on approved.order_id=o.id
where p.orden_id=o.id and upper(p.original_currency)<>'EUR' and p.planned_fx_foreign_per_eur is null
  and o.tipo_cambio_moneda_eur>0 and p.status not in ('parcial','pagado') and p.paid_at is null
  and p.actual_amount_original is null and p.actual_amount_eur is null
  and not exists(select 1 from public.finance_purchase_payment_allocations a where a.supplier_payment_id=p.id);

-- Grupos C/D: nunca inventan FX ni alteran importes reales.
update public.finance_supplier_payments p set planned_fx_regularization_status='manual_required',updated_at=now()
where p.planned_fx_foreign_per_eur is null and p.planned_fx_regularization_status is distinct from 'manual_required';

commit;
