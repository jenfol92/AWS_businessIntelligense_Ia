\set ON_ERROR_STOP on

-- Ejecutar siempre dentro de una transaccion explicita del operador.
-- Aplicacion definitiva: BEGIN; \ir 20260810_product_variant_inheritance_normalization.sql; COMMIT;
-- Ensayo:              BEGIN; \ir 20260810_product_variant_inheritance_normalization.sql; ROLLBACK;

DROP VIEW IF EXISTS pg_temp._variant_inheritance_values;
DROP TABLE IF EXISTS pg_temp._effective_before;
DROP TABLE IF EXISTS pg_temp._redundant_before;
DROP TABLE IF EXISTS pg_temp._ambiguous_before;
DROP TABLE IF EXISTS pg_temp._empty_before;
DROP TABLE IF EXISTS pg_temp._effective_changes;

CREATE TEMP VIEW _variant_inheritance_values AS
WITH variants AS (
  SELECT
    child.id AS variant_id,
    child.sku AS variant_sku,
    parent.id AS parent_id,
    parent.sku AS parent_sku,
    child.especificaciones AS child_specs,
    parent.especificaciones AS parent_specs,
    cd.categoria_id AS c_categoria, pd.categoria_id AS p_categoria,
    cl.unidades_por_caja AS c_upc, pl.unidades_por_caja AS p_upc,
    cl.pedido_minimo_unidades AS c_min, pl.pedido_minimo_unidades AS p_min,
    cl.peso_kg_bruto AS c_peso_bruto, pl.peso_kg_bruto AS p_peso_bruto,
    cl.largo_cm AS c_largo, pl.largo_cm AS p_largo,
    cl.ancho_cm AS c_ancho, pl.ancho_cm AS p_ancho,
    cl.alto_cm AS c_alto, pl.alto_cm AS p_alto,
    ct.peso_neto_kg AS c_peso_neto, pt.peso_neto_kg AS p_peso_neto,
    ct.material_estructura AS c_mat_est, pt.material_estructura AS p_mat_est,
    ct.material_tapizado AS c_mat_tap, pt.material_tapizado AS p_mat_tap,
    ct.material_ruedas AS c_mat_rue, pt.material_ruedas AS p_mat_rue,
    ct.alto_abierto_cm AS c_aa, pt.alto_abierto_cm AS p_aa,
    ct.ancho_abierto_cm AS c_ana, pt.ancho_abierto_cm AS p_ana,
    ct.fondo_abierto_cm AS c_fa, pt.fondo_abierto_cm AS p_fa,
    ct.alto_plegado_cm AS c_ap, pt.alto_plegado_cm AS p_ap,
    ct.ancho_plegado_cm AS c_anp, pt.ancho_plegado_cm AS p_anp,
    ct.fondo_plegado_cm AS c_fp, pt.fondo_plegado_cm AS p_fp
  FROM public.productos child
  JOIN public.productos parent ON parent.id = child.parent_id
  LEFT JOIN public.producto_detalle cd ON cd.producto_id = child.id
  LEFT JOIN public.producto_detalle pd ON pd.producto_id = parent.id
  LEFT JOIN public.producto_logistica cl ON cl.producto_id = child.id
  LEFT JOIN public.producto_logistica pl ON pl.producto_id = parent.id
  LEFT JOIN public.producto_ficha_tecnica ct ON ct.producto_id = child.id
  LEFT JOIN public.producto_ficha_tecnica pt ON pt.producto_id = parent.id
), scalar_values AS (
  SELECT v.variant_id, v.variant_sku, v.parent_id, v.parent_sku,
    x.block, x.field, x.parent_value, x.child_value,
    coalesce(x.child_value, x.parent_value) AS effective_value
  FROM variants v
  CROSS JOIN LATERAL (VALUES
    ('referencia_fabricante', 'referencia_fabricante', v.parent_specs#>>'{form_extensions_v1,identifiers,referencia_fabricante}', v.child_specs#>>'{form_extensions_v1,identifiers,referencia_fabricante}'),
    ('categoria', 'categoria_id', v.p_categoria::text, v.c_categoria::text),
    ('logistica', 'unidades_por_caja', v.p_upc::text, v.c_upc::text),
    ('logistica', 'pedido_minimo_unidades', v.p_min::text, v.c_min::text),
    ('pesos', 'peso_bruto', v.p_peso_bruto::text, v.c_peso_bruto::text),
    ('pesos', 'peso_neto', v.p_peso_neto::text, v.c_peso_neto::text),
    ('materiales', 'material_estructura', v.p_mat_est, v.c_mat_est),
    ('materiales', 'material_tapizado', v.p_mat_tap, v.c_mat_tap),
    ('materiales', 'material_ruedas', v.p_mat_rue, v.c_mat_rue),
    ('medidas', 'largo_caja', v.p_largo::text, v.c_largo::text),
    ('medidas', 'ancho_caja', v.p_ancho::text, v.c_ancho::text),
    ('medidas', 'alto_caja', v.p_alto::text, v.c_alto::text),
    ('medidas', 'alto_abierto', v.p_aa::text, v.c_aa::text),
    ('medidas', 'ancho_abierto', v.p_ana::text, v.c_ana::text),
    ('medidas', 'fondo_abierto', v.p_fa::text, v.c_fa::text),
    ('medidas', 'alto_plegado', v.p_ap::text, v.c_ap::text),
    ('medidas', 'ancho_plegado', v.p_anp::text, v.c_anp::text),
    ('medidas', 'fondo_plegado', v.p_fp::text, v.c_fp::text)
  ) x(block, field, parent_value, child_value)
), dynamic_values AS (
  SELECT v.variant_id, v.variant_sku, v.parent_id, v.parent_sku,
    'especificaciones_dinamicas'::text AS block,
    'categoria_spec:' || keys.key AS field,
    v.parent_specs->>keys.key AS parent_value,
    v.child_specs->>keys.key AS child_value,
    coalesce(v.child_specs->>keys.key, v.parent_specs->>keys.key) AS effective_value
  FROM variants v
  CROSS JOIN LATERAL (
    SELECT key
    FROM jsonb_object_keys(coalesce(v.child_specs, '{}'::jsonb) || coalesce(v.parent_specs, '{}'::jsonb)) key
    WHERE key <> 'form_extensions_v1'
  ) keys
)
SELECT * FROM scalar_values
UNION ALL
SELECT * FROM dynamic_values;

CREATE TEMP TABLE _effective_before ON COMMIT DROP AS
SELECT variant_id, field, effective_value
FROM _variant_inheritance_values;

CREATE TEMP TABLE _redundant_before ON COMMIT DROP AS
SELECT variant_id, variant_sku, parent_id, parent_sku, block, field, parent_value, child_value
FROM _variant_inheritance_values
WHERE nullif(btrim(child_value), '') IS NOT NULL
  AND child_value IS NOT DISTINCT FROM parent_value;

CREATE TEMP TABLE _ambiguous_before ON COMMIT DROP AS
SELECT variant_id, field, child_value
FROM _variant_inheritance_values
WHERE nullif(btrim(child_value), '') IS NOT NULL
  AND child_value IS DISTINCT FROM parent_value;

CREATE TEMP TABLE _empty_before ON COMMIT DROP AS
SELECT variant_id, field, child_value
FROM _variant_inheritance_values
WHERE nullif(btrim(child_value), '') IS NULL;

DO $$
DECLARE
  v_redundant integer;
  v_ambiguous integer;
  v_empty integer;
BEGIN
  SELECT count(*) INTO v_redundant FROM _redundant_before;
  SELECT count(*) INTO v_ambiguous FROM _ambiguous_before;
  SELECT count(*) INTO v_empty FROM _empty_before;
  IF v_ambiguous <> 28 THEN
    RAISE EXCEPTION 'EXPECTED_28_AMBIGUOUS_VALUES_GOT_%', v_ambiguous;
  END IF;
  IF NOT (
    (v_redundant = 513 AND v_empty = 338)
    OR (v_redundant = 0 AND v_empty = 851)
  ) THEN
    RAISE EXCEPTION 'UNVALIDATED_INHERITANCE_STATE: redundant=%, empty=%', v_redundant, v_empty;
  END IF;
  IF v_redundant = 513
     AND (SELECT count(DISTINCT variant_id) FROM _redundant_before) <> 47 THEN
    RAISE EXCEPTION 'EXPECTED_47_AFFECTED_VARIANTS_GOT_%',
      (SELECT count(DISTINCT variant_id) FROM _redundant_before);
  END IF;
END;
$$;

-- JSON: retira solo claves dinamicas hijas cuyo valor textual coincide exactamente.
UPDATE public.productos child
SET especificaciones = (
  SELECT coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  FROM jsonb_each(coalesce(child.especificaciones, '{}'::jsonb)) entry
  WHERE entry.key = 'form_extensions_v1'
     OR NOT (
       parent.especificaciones ? entry.key
       AND child.especificaciones->>entry.key IS NOT DISTINCT FROM parent.especificaciones->>entry.key
       AND nullif(btrim(child.especificaciones->>entry.key), '') IS NOT NULL
     )
)
FROM public.productos parent
WHERE parent.id = child.parent_id
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(coalesce(child.especificaciones, '{}'::jsonb)) entry
    WHERE entry.key <> 'form_extensions_v1'
      AND parent.especificaciones ? entry.key
      AND child.especificaciones->>entry.key IS NOT DISTINCT FROM parent.especificaciones->>entry.key
      AND nullif(btrim(child.especificaciones->>entry.key), '') IS NOT NULL
  );

-- Referencia fabricante: elimina solamente la clave redundante, no el resto del JSON.
UPDATE public.productos child
SET especificaciones = child.especificaciones #- '{form_extensions_v1,identifiers,referencia_fabricante}'
FROM public.productos parent
WHERE parent.id = child.parent_id
  AND nullif(btrim(child.especificaciones#>>'{form_extensions_v1,identifiers,referencia_fabricante}'), '') IS NOT NULL
  AND child.especificaciones#>>'{form_extensions_v1,identifiers,referencia_fabricante}'
      IS NOT DISTINCT FROM parent.especificaciones#>>'{form_extensions_v1,identifiers,referencia_fabricante}';

UPDATE public.producto_detalle child
SET categoria_id = NULL
FROM public.productos variant
JOIN public.producto_detalle parent ON parent.producto_id = variant.parent_id
WHERE variant.id = child.producto_id
  AND child.categoria_id IS NOT NULL
  AND child.categoria_id IS NOT DISTINCT FROM parent.categoria_id;

UPDATE public.producto_logistica child
SET
  unidades_por_caja = CASE WHEN child.unidades_por_caja IS NOT NULL AND child.unidades_por_caja IS NOT DISTINCT FROM parent.unidades_por_caja THEN NULL ELSE child.unidades_por_caja END,
  pedido_minimo_unidades = CASE WHEN child.pedido_minimo_unidades IS NOT NULL AND child.pedido_minimo_unidades IS NOT DISTINCT FROM parent.pedido_minimo_unidades THEN NULL ELSE child.pedido_minimo_unidades END,
  peso_kg_bruto = CASE WHEN child.peso_kg_bruto IS NOT NULL AND child.peso_kg_bruto IS NOT DISTINCT FROM parent.peso_kg_bruto THEN NULL ELSE child.peso_kg_bruto END,
  largo_cm = CASE WHEN child.largo_cm IS NOT NULL AND child.largo_cm IS NOT DISTINCT FROM parent.largo_cm THEN NULL ELSE child.largo_cm END,
  ancho_cm = CASE WHEN child.ancho_cm IS NOT NULL AND child.ancho_cm IS NOT DISTINCT FROM parent.ancho_cm THEN NULL ELSE child.ancho_cm END,
  alto_cm = CASE WHEN child.alto_cm IS NOT NULL AND child.alto_cm IS NOT DISTINCT FROM parent.alto_cm THEN NULL ELSE child.alto_cm END
FROM public.productos variant
JOIN public.producto_logistica parent ON parent.producto_id = variant.parent_id
WHERE variant.id = child.producto_id
  AND (
    (child.unidades_por_caja IS NOT NULL AND child.unidades_por_caja IS NOT DISTINCT FROM parent.unidades_por_caja)
    OR (child.pedido_minimo_unidades IS NOT NULL AND child.pedido_minimo_unidades IS NOT DISTINCT FROM parent.pedido_minimo_unidades)
    OR (child.peso_kg_bruto IS NOT NULL AND child.peso_kg_bruto IS NOT DISTINCT FROM parent.peso_kg_bruto)
    OR (child.largo_cm IS NOT NULL AND child.largo_cm IS NOT DISTINCT FROM parent.largo_cm)
    OR (child.ancho_cm IS NOT NULL AND child.ancho_cm IS NOT DISTINCT FROM parent.ancho_cm)
    OR (child.alto_cm IS NOT NULL AND child.alto_cm IS NOT DISTINCT FROM parent.alto_cm)
  );

UPDATE public.producto_ficha_tecnica child
SET
  peso_neto_kg = CASE WHEN child.peso_neto_kg IS NOT NULL AND child.peso_neto_kg IS NOT DISTINCT FROM parent.peso_neto_kg THEN NULL ELSE child.peso_neto_kg END,
  material_estructura = CASE WHEN nullif(btrim(child.material_estructura), '') IS NOT NULL AND child.material_estructura IS NOT DISTINCT FROM parent.material_estructura THEN NULL ELSE child.material_estructura END,
  material_tapizado = CASE WHEN nullif(btrim(child.material_tapizado), '') IS NOT NULL AND child.material_tapizado IS NOT DISTINCT FROM parent.material_tapizado THEN NULL ELSE child.material_tapizado END,
  material_ruedas = CASE WHEN nullif(btrim(child.material_ruedas), '') IS NOT NULL AND child.material_ruedas IS NOT DISTINCT FROM parent.material_ruedas THEN NULL ELSE child.material_ruedas END,
  alto_abierto_cm = CASE WHEN child.alto_abierto_cm IS NOT NULL AND child.alto_abierto_cm IS NOT DISTINCT FROM parent.alto_abierto_cm THEN NULL ELSE child.alto_abierto_cm END,
  ancho_abierto_cm = CASE WHEN child.ancho_abierto_cm IS NOT NULL AND child.ancho_abierto_cm IS NOT DISTINCT FROM parent.ancho_abierto_cm THEN NULL ELSE child.ancho_abierto_cm END,
  fondo_abierto_cm = CASE WHEN child.fondo_abierto_cm IS NOT NULL AND child.fondo_abierto_cm IS NOT DISTINCT FROM parent.fondo_abierto_cm THEN NULL ELSE child.fondo_abierto_cm END,
  alto_plegado_cm = CASE WHEN child.alto_plegado_cm IS NOT NULL AND child.alto_plegado_cm IS NOT DISTINCT FROM parent.alto_plegado_cm THEN NULL ELSE child.alto_plegado_cm END,
  ancho_plegado_cm = CASE WHEN child.ancho_plegado_cm IS NOT NULL AND child.ancho_plegado_cm IS NOT DISTINCT FROM parent.ancho_plegado_cm THEN NULL ELSE child.ancho_plegado_cm END,
  fondo_plegado_cm = CASE WHEN child.fondo_plegado_cm IS NOT NULL AND child.fondo_plegado_cm IS NOT DISTINCT FROM parent.fondo_plegado_cm THEN NULL ELSE child.fondo_plegado_cm END
FROM public.productos variant
JOIN public.producto_ficha_tecnica parent ON parent.producto_id = variant.parent_id
WHERE variant.id = child.producto_id
  AND (
    (child.peso_neto_kg IS NOT NULL AND child.peso_neto_kg IS NOT DISTINCT FROM parent.peso_neto_kg)
    OR (nullif(btrim(child.material_estructura), '') IS NOT NULL AND child.material_estructura IS NOT DISTINCT FROM parent.material_estructura)
    OR (nullif(btrim(child.material_tapizado), '') IS NOT NULL AND child.material_tapizado IS NOT DISTINCT FROM parent.material_tapizado)
    OR (nullif(btrim(child.material_ruedas), '') IS NOT NULL AND child.material_ruedas IS NOT DISTINCT FROM parent.material_ruedas)
    OR (child.alto_abierto_cm IS NOT NULL AND child.alto_abierto_cm IS NOT DISTINCT FROM parent.alto_abierto_cm)
    OR (child.ancho_abierto_cm IS NOT NULL AND child.ancho_abierto_cm IS NOT DISTINCT FROM parent.ancho_abierto_cm)
    OR (child.fondo_abierto_cm IS NOT NULL AND child.fondo_abierto_cm IS NOT DISTINCT FROM parent.fondo_abierto_cm)
    OR (child.alto_plegado_cm IS NOT NULL AND child.alto_plegado_cm IS NOT DISTINCT FROM parent.alto_plegado_cm)
    OR (child.ancho_plegado_cm IS NOT NULL AND child.ancho_plegado_cm IS NOT DISTINCT FROM parent.ancho_plegado_cm)
    OR (child.fondo_plegado_cm IS NOT NULL AND child.fondo_plegado_cm IS NOT DISTINCT FROM parent.fondo_plegado_cm)
  );

CREATE TEMP TABLE _effective_changes ON COMMIT DROP AS
SELECT
  coalesce(before.variant_id, after.variant_id) AS variant_id,
  coalesce(before.field, after.field) AS field,
  before.effective_value AS before_value,
  after.effective_value AS after_value
FROM _effective_before before
FULL JOIN (
  SELECT variant_id, field, effective_value
  FROM _variant_inheritance_values
) after USING (variant_id, field)
WHERE before.effective_value IS DISTINCT FROM after.effective_value;

DO $$
DECLARE
  v_effective_changes integer;
  v_remaining_redundant integer;
  v_ambiguous_changed integer;
  v_ambiguous_after integer;
  v_empty_materialized integer;
BEGIN
  SELECT count(*) INTO v_effective_changes FROM _effective_changes;
  IF v_effective_changes <> 0 THEN
    RAISE EXCEPTION 'EFFECTIVE_VALUES_CHANGED: %', v_effective_changes;
  END IF;

  SELECT count(*) INTO v_remaining_redundant
  FROM _variant_inheritance_values
  WHERE nullif(btrim(child_value), '') IS NOT NULL
    AND child_value IS NOT DISTINCT FROM parent_value;
  IF v_remaining_redundant <> 0 THEN
    RAISE EXCEPTION 'NORMALIZATION_NOT_IDEMPOTENT: % redundant values remain', v_remaining_redundant;
  END IF;

  SELECT count(*) INTO v_ambiguous_after
  FROM _variant_inheritance_values
  WHERE nullif(btrim(child_value), '') IS NOT NULL
    AND child_value IS DISTINCT FROM parent_value;
  SELECT count(*) INTO v_ambiguous_changed
  FROM _ambiguous_before before
  FULL JOIN (
    SELECT variant_id, field, child_value
    FROM _variant_inheritance_values
    WHERE nullif(btrim(child_value), '') IS NOT NULL
      AND child_value IS DISTINCT FROM parent_value
  ) after USING (variant_id, field)
  WHERE before.child_value IS DISTINCT FROM after.child_value;
  IF v_ambiguous_after <> 28 OR v_ambiguous_changed <> 0 THEN
    RAISE EXCEPTION 'AMBIGUOUS_VALUES_CHANGED: after=%, changed=%', v_ambiguous_after, v_ambiguous_changed;
  END IF;

  SELECT count(*) INTO v_empty_materialized
  FROM _empty_before before
  JOIN _variant_inheritance_values after USING (variant_id, field)
  WHERE before.child_value IS DISTINCT FROM after.child_value
    AND nullif(btrim(after.child_value), '') IS NOT NULL;
  IF v_empty_materialized <> 0 THEN
    RAISE EXCEPTION 'EMPTY_INHERITANCE_VALUES_MATERIALIZED: %', v_empty_materialized;
  END IF;

  IF (SELECT especificaciones#>>'{form_extensions_v1,identifiers,referencia_fabricante}' FROM public.productos WHERE sku = '8436616610548') IS DISTINCT FROM 'YT0327'
     OR (SELECT especificaciones#>>'{form_extensions_v1,identifiers,referencia_fabricante}' FROM public.productos WHERE sku = '8436616610678') IS DISTINCT FROM '2022' THEN
    RAISE EXCEPTION 'REAL_MANUFACTURER_REFERENCE_OVERRIDE_CHANGED';
  END IF;

  IF (SELECT count(*) FROM _variant_inheritance_values WHERE field = 'categoria_id' AND nullif(btrim(child_value), '') IS NOT NULL AND child_value IS DISTINCT FROM parent_value) <> 3 THEN
    RAISE EXCEPTION 'MANUAL_CATEGORY_DIFFERENCES_CHANGED';
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM _redundant_before) AS values_normalized,
  (SELECT count(DISTINCT variant_id) FROM _redundant_before) AS variants_affected,
  (SELECT count(*) FROM _effective_changes) AS effective_value_changes,
  (SELECT count(*) FROM _ambiguous_before WHERE field = 'referencia_fabricante') AS real_reference_overrides_preserved,
  (SELECT count(*) FROM _ambiguous_before WHERE field = 'categoria_id') AS manual_categories_preserved,
  (SELECT count(*) FROM _ambiguous_before WHERE field NOT IN ('referencia_fabricante', 'categoria_id')) AS other_ambiguous_values_preserved,
  (SELECT count(*) FROM _empty_before) AS empty_values_before,
  (SELECT count(*) FROM _variant_inheritance_values WHERE nullif(btrim(child_value), '') IS NOT NULL AND child_value IS NOT DISTINCT FROM parent_value) AS redundant_values_after;
