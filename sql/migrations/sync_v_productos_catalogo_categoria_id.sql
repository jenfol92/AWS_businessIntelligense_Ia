-- Migración: añadir categoria_id al FINAL de v_productos_catalogo.
--
-- IMPORTANTE (Postgres CREATE OR REPLACE VIEW):
-- No insertar columnas en medio del SELECT: Postgres interpreta cambios
-- de posición como renombrado de columnas (ERROR 42P16).
--
-- Orden actual verificado en Supabase (34 columnas) + categoria_id al final.

create or replace view public.v_productos_catalogo as
select
  p.id as producto_id,
  p.sku,
  p.nombre,
  p.asin,
  p.estado,
  p.proveedor_id,
  p.stock_seguridad_minimo,
  p.parent_id,
  p.heredar_precio,
  p.last_ordered_at,
  p.updated_at,

  d.imagen_url,
  d.marca,
  d.color,
  c.nombre as categoria,

  pr.nombre as proveedor_nombre,
  pr.pais as proveedor_pais,
  pr.puerto_preferido,
  pr.agente_id,

  ag.empresa as agente_empresa,
  ag.contacto as agente_contacto,

  coalesce(inv.stock_fba_total, 0) as stock_fba,
  coalesce(inv.stock_fbm_total, 0) as stock_fbm,
  coalesce(inv.stock_total, 0) as stock_total,

  va.precio_venta_objetivo,
  va.costo_total_estimado,
  va.margen_estimado,

  ss.dias_cobertura,
  ss.unidades_a_pedir,
  ss.riesgo,
  ss.avg_daily_used,

  ads.publicidad_gasto_ads_30d,
  ads.ventas_atribuidas_ads_30d,
  case
    when coalesce(ads.ventas_atribuidas_ads_30d, 0) > 0
      then ads.publicidad_gasto_ads_30d / ads.ventas_atribuidas_ads_30d
    else null
  end as acos_30d,

  d.categoria_id as categoria_id

from productos p

left join producto_detalle d
  on d.producto_id = p.id

left join categorias c
  on c.id = d.categoria_id

left join proveedores pr
  on pr.id = p.proveedor_id

left join agentes_compra ag
  on ag.id = pr.agente_id

left join v_profitabilidad_actual va
  on va.producto_id = p.id

left join v_stock_seguridad_sugerido ss
  on ss.producto_id = p.id

left join (
  select
    producto_id,
    sum(coalesce(stock_fba, 0)) as stock_fba_total,
    sum(coalesce(stock_fbm, 0)) as stock_fbm_total,
    sum(coalesce(stock_fba, 0) + coalesce(stock_fbm, 0)) as stock_total
  from inventario_paises
  group by producto_id
) inv
  on inv.producto_id = p.id

left join (
  select
    producto_id,
    sum(coalesce(publicidad_gasto_ads, 0)) as publicidad_gasto_ads_30d,
    sum(coalesce(ventas_atribuidas_ads, 0)) as ventas_atribuidas_ads_30d
  from v_ads_fba
  where fecha >= current_date - interval '30 days'
  group by producto_id
) ads
  on ads.producto_id = p.id;
