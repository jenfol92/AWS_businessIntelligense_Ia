-- Vista de sugerencias de reposición
-- Stock = FBA + FBM agregado de todos los países
-- Incluye: stock_actual, dias_cobertura, unidades_a_pedir, riesgo

create or replace view public.v_stock_seguridad_sugerido as
with params as (
  select
    7::int  as window_7,
    30::int as window_30,
    7::int  as buffer_days
),
sales_7 as (
  select
    vd.producto_id,
    sum(coalesce(vd.unidades_vendidas, 0))::numeric as units_7
  from public.ventas_diarias vd, params p
  where vd.fecha >= (current_date - (p.window_7 || ' days')::interval)
  group by vd.producto_id
),
sales_30 as (
  select
    vd.producto_id,
    sum(coalesce(vd.unidades_vendidas, 0))::numeric as units_30
  from public.ventas_diarias vd, params p
  where vd.fecha >= (current_date - (p.window_30 || ' days')::interval)
  group by vd.producto_id
),
lead as (
  select
    pr.id as producto_id,
    pr.proveedor_id,
    (coalesce(pv.dias_produccion_estandar, 0)
     + coalesce(pv.dias_transito_estandar, 0))::numeric as lead_time_days
  from public.productos pr
  left join public.proveedores pv on pv.id = pr.proveedor_id
),
-- Stock total (FBA + FBM) sumado de todos los países
stock_agg as (
  select
    producto_id,
    sum(coalesce(stock_fba, 0) + coalesce(stock_fbm, 0))::int as stock_total,
    sum(coalesce(stock_fba, 0))::int                           as stock_fba_total,
    sum(coalesce(stock_fbm, 0))::int                           as stock_fbm_total
  from public.inventario_paises
  group by producto_id
)
select
  pr.id                                              as producto_id,
  pr.sku,
  pr.nombre,
  pr.stock_seguridad_minimo,
  lead.proveedor_id,
  coalesce(lead.lead_time_days, 0)                   as lead_time_days,
  p.buffer_days,

  -- ventas medias diarias (la más alta de las dos ventanas)
  (coalesce(s7.units_7,  0) / p.window_7)            as avg_daily_7,
  (coalesce(s30.units_30, 0) / p.window_30)          as avg_daily_30,
  greatest(
    coalesce(s7.units_7,  0) / p.window_7,
    coalesce(s30.units_30, 0) / p.window_30
  )                                                   as avg_daily_used,

  -- stock actual (FBA + FBM de todos los países)
  coalesce(sa.stock_total,     0)                    as stock_actual,
  coalesce(sa.stock_fba_total, 0)                    as stock_fba,
  coalesce(sa.stock_fbm_total, 0)                    as stock_fbm,

  -- stock de seguridad recomendado (lead time + buffer días de ventas)
  ceiling(
    greatest(
      coalesce(s7.units_7,  0) / p.window_7,
      coalesce(s30.units_30, 0) / p.window_30
    ) * (coalesce(lead.lead_time_days, 0) + p.buffer_days)
  )::int                                              as stock_seguridad_sugerido,

  -- días de cobertura con stock actual
  case
    when greatest(
           coalesce(s7.units_7,  0) / p.window_7,
           coalesce(s30.units_30, 0) / p.window_30
         ) > 0
    then round(
           (coalesce(sa.stock_total, 0)::numeric
            / greatest(
                coalesce(s7.units_7,  0) / p.window_7,
                coalesce(s30.units_30, 0) / p.window_30
              )
           ), 1
         )
    else null
  end                                                 as dias_cobertura,

  -- unidades a pedir = cuánto falta para cubrir lead_time + buffer + mínimo
  greatest(
    0,
    (
      ceiling(
        greatest(
          coalesce(s7.units_7,  0) / p.window_7,
          coalesce(s30.units_30, 0) / p.window_30
        ) * (coalesce(lead.lead_time_days, 0) + p.buffer_days)
      )::int
      + coalesce(pr.stock_seguridad_minimo, 0)
      - coalesce(sa.stock_total, 0)
    )
  )::int                                              as unidades_a_pedir,

  -- riesgo
  case
    when coalesce(sa.stock_total, 0) = 0
         and greatest(
               coalesce(s7.units_7,  0) / p.window_7,
               coalesce(s30.units_30, 0) / p.window_30
             ) > 0
      then 'critico'
    when pr.stock_seguridad_minimo is not null
         and coalesce(sa.stock_total, 0) <= pr.stock_seguridad_minimo
      then 'critico'
    when greatest(
           coalesce(s7.units_7,  0) / p.window_7,
           coalesce(s30.units_30, 0) / p.window_30
         ) > 0
         and (coalesce(sa.stock_total, 0)::numeric
              / greatest(
                  coalesce(s7.units_7,  0) / p.window_7,
                  coalesce(s30.units_30, 0) / p.window_30
                )
             ) < 14
      then 'critico'
    when greatest(
           coalesce(s7.units_7,  0) / p.window_7,
           coalesce(s30.units_30, 0) / p.window_30
         ) > 0
         and (coalesce(sa.stock_total, 0)::numeric
              / greatest(
                  coalesce(s7.units_7,  0) / p.window_7,
                  coalesce(s30.units_30, 0) / p.window_30
                )
             ) < 30
      then 'bajo'
    when greatest(
           coalesce(s7.units_7,  0) / p.window_7,
           coalesce(s30.units_30, 0) / p.window_30
         ) = 0
      then 'sin_ventas'
    else 'ok'
  end                                                 as riesgo

from public.productos pr
cross join params p
left join lead        on lead.producto_id = pr.id
left join stock_agg   sa on sa.producto_id = pr.id
left join sales_7     s7 on s7.producto_id = pr.id
left join sales_30    s30 on s30.producto_id = pr.id
where pr.estado = 'activo';
