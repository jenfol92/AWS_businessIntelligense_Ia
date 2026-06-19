-- Diagnóstico: calendario financiero, pagos proveedor y líneas de crédito.
-- Ejecutar en Supabase SQL Editor.

-- 1) Inspección de tablas relacionadas
select table_name
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%fin%'
    or table_name ilike '%pago%'
    or table_name ilike '%credit%'
    or table_name ilike '%credito%'
    or table_name ilike '%linea%'
  )
order by table_name;

-- 2) Columnas de tablas financieras
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%fin%'
    or table_name ilike '%pago%'
    or table_name ilike '%credit%'
    or table_name ilike '%credito%'
    or table_name ilike '%linea%'
  )
order by table_name, ordinal_position;

-- 3) Pagos proveedor por orden
select
  fsp.id,
  fsp.orden_id,
  oc.numero_orden,
  fsp.payment_type,
  fsp.due_date,
  fsp.amount_eur,
  fsp.logistics_type,
  fsp.contenedor_id,
  fsp.status,
  fsp.notes,
  fsp.created_at,
  fsp.updated_at
from public.finance_supplier_payments fsp
left join public.ordenes_compra oc on oc.id = fsp.orden_id
order by oc.numero_orden, fsp.payment_type;

-- 4) Duplicados por orden_id + payment_type (debe devolver 0 filas)
select
  orden_id,
  payment_type,
  count(*) as filas
from public.finance_supplier_payments
group by orden_id, payment_type
having count(*) > 1;

-- 5) Tipo de contenedor usado para balance 70 %
select
  fsp.orden_id,
  oc.numero_orden,
  fsp.payment_type,
  fsp.logistics_type as tipo_guardado_en_pago,
  c.tipo_contenedor as tipo_contenedor_vinculado,
  c.identificador_embarque
from public.finance_supplier_payments fsp
left join public.ordenes_compra oc on oc.id = fsp.orden_id
left join public.contenedores c on c.id = fsp.contenedor_id
where fsp.payment_type = 'BALANCE_70'
order by oc.numero_orden;

-- 6) Fecha usada para balance 70 % (amazon_agl vs propio)
select
  oc.numero_orden,
  fsp.logistics_type,
  fsp.due_date as fecha_balance_pago,
  c.fecha_salida as contenedor_fecha_salida,
  oc.etd as orden_etd,
  c.fecha_eta_estimada as contenedor_eta,
  oc.eta as orden_eta,
  oc.balance_dias_antes_eta,
  oc.fecha_pago_balance as orden_fecha_pago_balance_calc
from public.finance_supplier_payments fsp
join public.ordenes_compra oc on oc.id = fsp.orden_id
left join public.contenedores c on c.id = fsp.contenedor_id
where fsp.payment_type = 'BALANCE_70'
order by fsp.due_date nulls last;

-- 7) Líneas de crédito existentes
select
  id,
  bank_name,
  line_name,
  credit_limit,
  used_amount,
  available_amount,
  cycle_days,
  repayment_mode,
  priority,
  status
from public.finance_credit_lines
order by priority nulls last, bank_name;

-- 8) Movimientos / consumos de líneas
select
  m.id,
  l.bank_name,
  l.line_name,
  m.movement_type,
  m.description,
  m.due_date,
  m.amount,
  m.status,
  m.source_type,
  m.source_id,
  m.paid_at,
  m.created_at
from public.finance_credit_line_movements m
join public.finance_credit_lines l on l.id = m.credit_line_id
order by m.due_date nulls last, l.bank_name;

-- 9) Vencimientos de línea generados desde pagos proveedor
select
  m.id,
  l.bank_name,
  m.due_date,
  m.amount,
  m.status,
  fsp.payment_type,
  oc.numero_orden,
  fsp.due_date as fecha_pago_proveedor,
  l.cycle_days
from public.finance_credit_line_movements m
join public.finance_credit_lines l on l.id = m.credit_line_id
left join public.finance_supplier_payments fsp on fsp.id = m.source_id and m.source_type = 'supplier_payment'
left join public.ordenes_compra oc on oc.id = fsp.orden_id
where m.movement_type = 'vencimiento_linea'
order by m.due_date;

-- 10) Órdenes confirmadas sin pagos proveedor sincronizados
select
  oc.id,
  oc.numero_orden,
  oc.fecha_confirmacion,
  oc.estado
from public.ordenes_compra oc
left join public.finance_supplier_payments fsp on fsp.orden_id = oc.id
where oc.estado = 'confirmado'
  and fsp.id is null
order by oc.fecha_confirmacion desc;

-- 11) Contenedores con órdenes confirmadas (no deben generar pagos extra, solo actualizar fechas)
select
  c.identificador_embarque,
  c.tipo_contenedor,
  oc.numero_orden,
  count(fsp.id) filter (where fsp.payment_type = 'DEPOSITO_30') as depositos,
  count(fsp.id) filter (where fsp.payment_type = 'BALANCE_70') as balances
from public.contenedores c
join public.contenedor_ordenes co on co.contenedor_id = c.id
join public.ordenes_compra oc on oc.id = co.orden_id
left join public.finance_supplier_payments fsp on fsp.orden_id = oc.id
where oc.estado = 'confirmado'
group by c.identificador_embarque, c.tipo_contenedor, oc.numero_orden
having count(fsp.id) filter (where fsp.payment_type = 'DEPOSITO_30') > 1
    or count(fsp.id) filter (where fsp.payment_type = 'BALANCE_70') > 1;
