-- Vista de profitabilidad actual por producto.
--
-- El precio objetivo de venta se lee ahora desde `producto_precios` (se
-- selecciona la fila GLOBAL vigente más reciente del canal por defecto
-- AMAZON_FBA; como fallback usa cualquier canal vigente). Se eliminó la
-- dependencia de `producto_finanzas`, que ha quedado obsoleta.
--
-- Los costes se leen de `producto_costos` con los nombres del esquema
-- actual (tras la migración `fase1_contenedor_facturado_costes.sql`):
-- `transito_eur_unit`, `gastos_llegada_puerto_eur_unit`,
-- `costo_flete_unit_eur`, `costo_unitario_total_eur`.

-- Ojo: Postgres no permite `CREATE OR REPLACE VIEW` si cambian el nombre
-- o tipo de alguna columna de salida. Por eso borramos la vista anterior
-- con CASCADE (no hay vistas encadenadas actualmente). Si tuvieras otras
-- vistas que dependan de ésta, reemplaza CASCADE por RESTRICT y recrea
-- las dependientes después.
drop view if exists public.v_profitabilidad_actual cascade;

create view public.v_profitabilidad_actual as
with ultimo_costo as (
  select distinct on (pc.producto_id)
    pc.producto_id,
    pc.proveedor_id,
    pc.fecha                          as costo_fecha,
    pc.costo_fabrica_eur,
    pc.arancel_porcentaje,
    pc.transito_eur_unit,
    pc.gastos_llegada_puerto_eur_unit,
    pc.costo_flete_unit_eur,
    pc.costo_unitario_total_eur
  from public.producto_costos pc
  order by pc.producto_id, pc.fecha desc nulls last
),
precio_base as (
  select distinct on (pp.producto_id)
    pp.producto_id,
    pp.precio as precio_venta_objetivo
  from public.producto_precios pp
  where pp.pais_code is null
    and (pp.valid_from is null or pp.valid_from <= current_date)
    and (pp.valid_to   is null or pp.valid_to   >= current_date)
  order by
    pp.producto_id,
    case pp.channel when 'AMAZON_FBA' then 0 else 1 end,
    case pp.price_type when 'GENERAL' then 0 else 1 end,
    pp.valid_from desc nulls last
)
select
  p.id  as producto_id,
  p.sku,
  p.nombre,
  pb.precio_venta_objetivo,
  uc.proveedor_id,
  uc.costo_fecha,
  uc.costo_fabrica_eur,
  uc.arancel_porcentaje,
  uc.transito_eur_unit,
  uc.gastos_llegada_puerto_eur_unit,
  uc.costo_flete_unit_eur,
  coalesce(
    uc.costo_unitario_total_eur,
    coalesce(uc.costo_fabrica_eur, 0)
      * (1 + coalesce(uc.arancel_porcentaje, 0) / 100)
      + coalesce(uc.transito_eur_unit, 0)
      + coalesce(uc.gastos_llegada_puerto_eur_unit, 0)
      + coalesce(uc.costo_flete_unit_eur, 0)
  ) as costo_total_estimado,
  pb.precio_venta_objetivo as precio_objetivo_sin_iva,
  case
    when pb.precio_venta_objetivo is null then null
    else pb.precio_venta_objetivo
      - coalesce(
          uc.costo_unitario_total_eur,
          coalesce(uc.costo_fabrica_eur, 0)
            * (1 + coalesce(uc.arancel_porcentaje, 0) / 100)
            + coalesce(uc.transito_eur_unit, 0)
            + coalesce(uc.gastos_llegada_puerto_eur_unit, 0)
            + coalesce(uc.costo_flete_unit_eur, 0)
        )
  end as margen_estimado
from public.productos p
left join precio_base   pb on pb.producto_id = p.id
left join ultimo_costo  uc on uc.producto_id = p.id;
