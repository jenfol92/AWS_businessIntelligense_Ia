-- Diagnóstico FASE 1: finance_supplier_payments en Supabase.
-- Ejecutar en SQL Editor de Supabase.

-- 1) Total de pagos proveedor existentes
select count(*) as total_pagos_proveedor
from public.finance_supplier_payments;

-- 2) Estado de órdenes de compra
select
  estado,
  count(*) as total
from public.ordenes_compra
group by estado
order by estado;

-- 3) Órdenes confirmadas SIN pagos proveedor (deben ser 0 tras backfill)
select
  oc.id as orden_id,
  oc.numero_orden,
  oc.estado,
  count(fsp.id) as pagos_proveedor
from public.ordenes_compra oc
left join public.finance_supplier_payments fsp
  on fsp.orden_id = oc.id
where oc.estado = 'confirmado'
group by oc.id, oc.numero_orden, oc.estado
having count(fsp.id) = 0
order by oc.id;

-- 4) Duplicados (debe devolver 0 filas)
select
  orden_id,
  payment_type,
  count(*) as veces
from public.finance_supplier_payments
group by orden_id, payment_type
having count(*) > 1;

-- 5) Estado completo — últimos 50 registros
select
  id,
  orden_id,
  payment_type,
  amount_original,
  original_currency,
  amount_eur,
  due_date,
  status,
  logistics_type,
  planned_fx_rate,
  contenedor_id,
  payment_source,
  paid_at,
  created_at,
  updated_at
from public.finance_supplier_payments
order by created_at desc
limit 50;

-- 6) Distribución de logistics_type (debe mostrar amazon_agl / propio / sin_definir)
select
  logistics_type,
  count(*) as total
from public.finance_supplier_payments
group by logistics_type
order by logistics_type;

-- 7) Columnas reales de la tabla
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'finance_supplier_payments'
order by ordinal_position;

-- 8) Índice único de idempotencia
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'finance_supplier_payments'
  and indexdef ilike '%unique%'
  and indexdef ilike '%orden_id%'
  and indexdef ilike '%payment_type%';

-- 9) RLS y policies
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'finance_supplier_payments';

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'finance_supplier_payments'
order by policyname;

-- 10) Pagos pendientes sin logistics_type resuelto (candidatos a refresh)
select
  fsp.id,
  fsp.orden_id,
  oc.numero_orden,
  fsp.payment_type,
  fsp.logistics_type,
  fsp.due_date,
  fsp.contenedor_id,
  c.tipo_contenedor,
  c.identificador_embarque
from public.finance_supplier_payments fsp
left join public.ordenes_compra oc on oc.id = fsp.orden_id
left join public.contenedores c on c.id = fsp.contenedor_id
where fsp.status = 'pendiente'
  and (
    fsp.logistics_type is null
    or fsp.logistics_type = 'sin_definir'
    or fsp.logistics_type = 'SIN_DEFINIR'
  )
order by oc.numero_orden, fsp.payment_type;
