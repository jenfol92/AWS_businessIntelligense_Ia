-- Normalización FASE 1: convierte logistics_type de formato etiqueta a formato canónico.
-- Ejecutar una sola vez en Supabase SQL Editor.
-- Seguro de re-ejecutar: solo actualiza las filas con valores legado.

update public.finance_supplier_payments
set logistics_type = case
  when upper(trim(logistics_type)) = 'AGL'         then 'amazon_agl'
  when upper(trim(logistics_type)) = 'AMAZON_AGL'  then 'amazon_agl'
  when upper(trim(logistics_type)) = 'PROPIO'       then 'propio'
  when upper(trim(logistics_type)) = 'SIN_DEFINIR'  then 'sin_definir'
  else logistics_type
end
where logistics_type in ('AGL', 'AMAZON_AGL', 'PROPIO', 'SIN_DEFINIR');

-- Verificar resultado:
select logistics_type, count(*) as total
from public.finance_supplier_payments
group by logistics_type
order by logistics_type;
