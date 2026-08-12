BEGIN TRANSACTION READ ONLY;

WITH variants AS (
  SELECT
    child.id AS variant_id,
    child.sku AS variant_sku,
    parent.id AS parent_id,
    parent.sku AS parent_sku,
    child.especificaciones AS child_specs,
    parent.especificaciones AS parent_specs,
    cd.categoria_id AS child_categoria_id,
    pd.categoria_id AS parent_categoria_id,
    cl.*, pl.*,
    ct.*, pt.*
  FROM public.productos child
  JOIN public.productos parent ON parent.id = child.parent_id
  LEFT JOIN public.producto_detalle cd ON cd.producto_id = child.id
  LEFT JOIN public.producto_detalle pd ON pd.producto_id = parent.id
  LEFT JOIN public.producto_logistica cl ON cl.producto_id = child.id
  LEFT JOIN public.producto_logistica pl ON pl.producto_id = parent.id
  LEFT JOIN public.producto_ficha_tecnica ct ON ct.producto_id = child.id
  LEFT JOIN public.producto_ficha_tecnica pt ON pt.producto_id = parent.id
)
SELECT count(*) AS total_variants FROM variants;

WITH variants AS (
  SELECT child.id, child.especificaciones child_specs, parent.especificaciones parent_specs,
    cd.categoria_id c_categoria, pd.categoria_id p_categoria,
    cl.unidades_por_caja c_upc, pl.unidades_por_caja p_upc,
    cl.pedido_minimo_unidades c_min, pl.pedido_minimo_unidades p_min,
    cl.peso_kg_bruto c_peso_bruto, pl.peso_kg_bruto p_peso_bruto,
    cl.largo_cm c_largo, pl.largo_cm p_largo, cl.ancho_cm c_ancho, pl.ancho_cm p_ancho, cl.alto_cm c_alto, pl.alto_cm p_alto,
    ct.peso_neto_kg c_peso_neto, pt.peso_neto_kg p_peso_neto,
    ct.material_estructura c_mat_est, pt.material_estructura p_mat_est,
    ct.material_tapizado c_mat_tap, pt.material_tapizado p_mat_tap,
    ct.material_ruedas c_mat_rue, pt.material_ruedas p_mat_rue,
    ct.alto_abierto_cm c_aa, pt.alto_abierto_cm p_aa, ct.ancho_abierto_cm c_ana, pt.ancho_abierto_cm p_ana,
    ct.fondo_abierto_cm c_fa, pt.fondo_abierto_cm p_fa, ct.alto_plegado_cm c_ap, pt.alto_plegado_cm p_ap,
    ct.ancho_plegado_cm c_anp, pt.ancho_plegado_cm p_anp, ct.fondo_plegado_cm c_fp, pt.fondo_plegado_cm p_fp
  FROM public.productos child JOIN public.productos parent ON parent.id=child.parent_id
  LEFT JOIN public.producto_detalle cd ON cd.producto_id=child.id LEFT JOIN public.producto_detalle pd ON pd.producto_id=parent.id
  LEFT JOIN public.producto_logistica cl ON cl.producto_id=child.id LEFT JOIN public.producto_logistica pl ON pl.producto_id=parent.id
  LEFT JOIN public.producto_ficha_tecnica ct ON ct.producto_id=child.id LEFT JOIN public.producto_ficha_tecnica pt ON pt.producto_id=parent.id
), values_to_classify AS (
  SELECT id, field, child_value, parent_value FROM variants v
  CROSS JOIN LATERAL (VALUES
    ('referencia_fabricante', v.child_specs#>>'{form_extensions_v1,identifiers,referencia_fabricante}', v.parent_specs#>>'{form_extensions_v1,identifiers,referencia_fabricante}'),
    ('categoria_id', v.c_categoria::text, v.p_categoria::text), ('unidades_por_caja', v.c_upc::text, v.p_upc::text),
    ('pedido_minimo_unidades', v.c_min::text, v.p_min::text), ('peso_bruto', v.c_peso_bruto::text, v.p_peso_bruto::text),
    ('largo_caja', v.c_largo::text, v.p_largo::text), ('ancho_caja', v.c_ancho::text, v.p_ancho::text), ('alto_caja', v.c_alto::text, v.p_alto::text),
    ('peso_neto', v.c_peso_neto::text, v.p_peso_neto::text), ('material_estructura', v.c_mat_est, v.p_mat_est),
    ('material_tapizado', v.c_mat_tap, v.p_mat_tap), ('material_ruedas', v.c_mat_rue, v.p_mat_rue),
    ('alto_abierto', v.c_aa::text, v.p_aa::text), ('ancho_abierto', v.c_ana::text, v.p_ana::text), ('fondo_abierto', v.c_fa::text, v.p_fa::text),
    ('alto_plegado', v.c_ap::text, v.p_ap::text), ('ancho_plegado', v.c_anp::text, v.p_anp::text), ('fondo_plegado', v.c_fp::text, v.p_fp::text)
  ) x(field, child_value, parent_value)
  UNION ALL
  SELECT v.id, 'categoria_spec:' || keys.key, v.child_specs->>keys.key, v.parent_specs->>keys.key
  FROM variants v
  CROSS JOIN LATERAL (
    SELECT key FROM jsonb_object_keys(coalesce(v.child_specs, '{}'::jsonb) || coalesce(v.parent_specs, '{}'::jsonb)) key
    WHERE key <> 'form_extensions_v1'
  ) keys
), classified AS (
  SELECT field,
    CASE WHEN nullif(btrim(child_value), '') IS NULL THEN 'empty'
         WHEN child_value IS NOT DISTINCT FROM parent_value THEN 'equal_to_parent'
         ELSE 'different_from_parent' END AS classification
  FROM values_to_classify
)
SELECT coalesce(field, '__TOTAL_VALUES__') AS field,
  count(*) FILTER (WHERE classification='equal_to_parent') AS equal_to_parent,
  count(*) FILTER (WHERE classification='different_from_parent') AS different_from_parent,
  count(*) FILTER (WHERE classification='empty') AS empty,
  count(*) AS total_values
FROM classified
GROUP BY GROUPING SETS ((field), ())
ORDER BY field;

ROLLBACK;
