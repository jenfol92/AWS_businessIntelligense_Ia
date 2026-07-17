-- SELECT-only: audita variantes ya creadas antes de cualquier reparacion.
-- Sustituir :parent_product_id por el UUID del producto padre afectado.
-- No ejecuta INSERT/UPDATE/DELETE.

with family as (
  select
    p.id,
    p.parent_id,
    p.sku,
    p.nombre,
    p.estado,
    coalesce(p.parent_id, p.id) as family_parent_id,
    p.proveedor_id,
    p.stock_seguridad_minimo,
    p.arancel_porcentaje,
    p.especificaciones
  from productos p
  where p.id = :parent_product_id
     or p.parent_id = :parent_product_id
),
parent_product as (
  select *
  from family
  where id = :parent_product_id
),
latest_cost as (
  select distinct on (pc.producto_id)
    pc.producto_id,
    pc.costo_fabrica_monto,
    pc.costo_fabrica_moneda,
    pc.proveedor_id as costo_proveedor_id,
    pc.arancel_porcentaje as costo_arancel_porcentaje,
    pc.fecha
  from producto_costos pc
  where pc.producto_id in (select id from family)
  order by pc.producto_id, pc.fecha desc
),
spec_counts as (
  select
    f.id as producto_id,
    count(*) filter (
      where e.key <> 'form_extensions_v1'
    ) as especificaciones_count
  from family f
  left join lateral jsonb_each(coalesce(f.especificaciones::jsonb, '{}'::jsonb)) e on true
  group by f.id
)
select
  pp.id as producto_padre_id,
  pp.sku as producto_padre_sku,
  v.id as variante_id,
  v.sku as variante_sku,
  v.nombre as variante_nombre,
  pdp.categoria_id as categoria_padre_id,
  pdv.categoria_id as categoria_variante_id,
  pdp.color as color_padre,
  pdv.color as color_variante,
  pp.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}'
    as referencia_fabricante_padre,
  v.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}'
    as referencia_fabricante_variante,
  scp.especificaciones_count as especificaciones_padre_count,
  scv.especificaciones_count as especificaciones_variante_count,
  ftp.material_estructura as material_estructura_padre,
  ftv.material_estructura as material_estructura_variante,
  ftp.material_tapizado as material_tapizado_padre,
  ftv.material_tapizado as material_tapizado_variante,
  ftp.material_ruedas as material_ruedas_padre,
  ftv.material_ruedas as material_ruedas_variante,
  ftp.peso_neto_kg as peso_neto_padre,
  ftv.peso_neto_kg as peso_neto_variante,
  lp.peso_kg_bruto as peso_bruto_padre,
  lv.peso_kg_bruto as peso_bruto_variante,
  lp.largo_cm as largo_caja_padre,
  lv.largo_cm as largo_caja_variante,
  lp.ancho_cm as ancho_caja_padre,
  lv.ancho_cm as ancho_caja_variante,
  lp.alto_cm as alto_caja_padre,
  lv.alto_cm as alto_caja_variante,
  lp.cubicaje_unitario_m3 as cubicaje_padre_generado,
  lv.cubicaje_unitario_m3 as cubicaje_variante_generado,
  cp.costo_fabrica_monto as coste_fabrica_padre,
  cv.costo_fabrica_monto as coste_fabrica_variante,
  cp.costo_fabrica_moneda as moneda_coste_padre,
  cv.costo_fabrica_moneda as moneda_coste_variante,
  case
    when pdv.color is distinct from pdp.color then 'OK_COLOR_PROPIO_VARIANTE'
    else 'REVISAR_COLOR_NO_DEBE_HEREDARSE'
  end as estado_color,
  case
    when cv.producto_id is null then 'COSTE_VARIANTE_AUSENTE'
    when cv.costo_fabrica_monto is distinct from cp.costo_fabrica_monto
      or cv.costo_fabrica_moneda is distinct from cp.costo_fabrica_moneda
      then 'COSTE_VARIANTE_DIFERENTE_REVISAR_SI_FUE_EDITADO'
    else 'OK_COSTE_HEREDADO'
  end as estado_coste,
  case
    when pdv.categoria_id is null
      or v.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}' is null
      or scv.especificaciones_count = 0
      or ftv.producto_id is null
      or lv.producto_id is null
      then 'VARIANTE_CON_HUECOS_HEREDABLES'
    else 'OK_DATOS_HEREDABLES_PRESENTES'
  end as estado_herencia
from parent_product pp
join family v on v.parent_id = pp.id
left join producto_detalle pdp on pdp.producto_id = pp.id
left join producto_detalle pdv on pdv.producto_id = v.id
left join producto_ficha_tecnica ftp on ftp.producto_id = pp.id
left join producto_ficha_tecnica ftv on ftv.producto_id = v.id
left join producto_logistica lp on lp.producto_id = pp.id
left join producto_logistica lv on lv.producto_id = v.id
left join latest_cost cp on cp.producto_id = pp.id
left join latest_cost cv on cv.producto_id = v.id
left join spec_counts scp on scp.producto_id = pp.id
left join spec_counts scv on scv.producto_id = v.id
order by v.nombre, v.sku;
