# sql/migrations/

Clasificación de los scripts de migración del proyecto. Ningún archivo ha
sido movido ni eliminado; esta clasificación es solo documental.

Actualizado: FASE A-3B1 (2026-06-19).

---

## 1. VIGENTES / CANÓNICAS

Scripts que representan el estado esperado actual del esquema. Deben existir
aplicados en Supabase. Si una BD nueva se construye desde cero, estos scripts
definen la estructura final.

| Script | Qué hace |
|--------|----------|
| `finance_supplier_payments.sql` | Crea la tabla `finance_supplier_payments`, constraints de `payment_type` y `status`, índice único `(orden_id, payment_type)` e índice por `due_date`. Base de la FASE 1 de pagos a proveedor. |
| `finance_planning_base.sql` | Crea `finance_credit_lines`, `finance_credit_line_movements`, `finance_cash_accounts`, `finance_amazon_income_forecasts` y `finance_settings`, e inserta las líneas bancarias iniciales. |
| `contenedor_ordenes_rls_policies.sql` | RLS de `contenedor_ordenes` (select / insert / delete para `authenticated`). |
| `contenedor_ordenes_unique_orden_id.sql` | Índice único `(orden_id)` en `contenedor_ordenes` (una orden solo puede vincularse a un contenedor). **Ejecutar el diagnóstico** `contenedor_ordenes_ordenes_duplicadas.sql` antes de aplicar. |
| `contenedores_estados_separados.sql` | Separa el estado de contenedor en tres ejes independientes: `estado_logistico`, `estado_stock`, `estado_costes`. Normaliza `tipo_contenedor` a valores canónicos. Backfill desde `estado` legacy. |
| `contenedor_stock_destinos.sql` | Crea `contenedor_stock_destinos` (distribución FBA/FBM por línea antes de aplicar stock) y trigger `updated_at`. |
| `contenedor_stock_aplicado_unique_activo.sql` | Índice único parcial en `contenedor_stock_aplicado` para evitar doble aplicación activa de stock. |
| `producto_costos_contenedor_lote_unique.sql` | Índice único en `producto_costos (contenedor_id, producto_id, COALESCE(lote_producto, ''))` para idempotencia de facturación de costes. |
| `ordenes_compra_payment_etd_eta.sql` | Añade ETD, ETA real, campos de pago a `ordenes_compra`, renombra `destino_puerto` a `destino` y crea el trigger `trg_calcular_fecha_pago_balance`. Alto impacto por rename y trigger. |
| `ordenes_compra_moneda.sql` | Añade moneda de compra, tipo de cambio y coste en moneda a órdenes y líneas. Redefine `recalc_orden_totales`. |
| `ordenes_compra_agente_id.sql` | Añade `agente_id` a `ordenes_compra` con FK a `agentes_compra`. |
| `proveedores_forma_pago.sql` | Añade `deposito_porcentaje`, `balance_dias_antes_eta` y `balance_condiciones_texto` a `proveedores`. |
| `forecast_inbound_items.sql` | Añade `fecha_eta_original` a `contenedores` y crea la vista `v_forecast_inbound_items`. |
| `fase2_lotes_coste_medio.sql` | Añade `lote_producto` a `orden_items` y `producto_costos` y crea la vista `v_producto_coste_medio`. |
| `fase3_stock_entregado.sql` | Crea `contenedor_stock_aplicado`, RPC `fn_stock_add` (SECURITY DEFINER) y tabla `puerto_pais`. |
| `fase4_amazon_envios.sql` | Crea `amazon_envios` y sus índices para importar envíos FBA con vínculo a contenedores. |
| `amazon_spapi_report_jobs.sql` | Crea `amazon_spapi_report_jobs` (cola de reports SP-API). |
| `amazon_all_orders_items.sql` | Crea `amazon_all_orders_items` (staging RAW All Orders). |
| `amazon_fba_inventory_ledger_daily.sql` | Crea `amazon_fba_inventory_ledger_daily` y la vista `v_product_fba_stock_daily`. |
| `fba_country_stock_daily.sql` | Crea `fba_country_stock_daily` (histórico diario FBA por país). |
| `ventas_diarias_all_orders_unique.sql` | Amplía el grano único de `ventas_diarias` con `moneda`, `tipo_cliente` y `marketplace_id`. Elimina índice antiguo. |
| `ventas_diarias_source.sql` | Añade columna `source` a `ventas_diarias`. |
| `fix_amazon_fba_ledger_unique_key.sql` | Corrige la clave única del ledger FBA para no colapsar MSKU/FNSKU distintos. |
| `amazon_payments_fba.sql` | Crea `amazon_payments_imports`, `amazon_payments_transactions`, la vista `v_ventas_fba_payments` y la función `sync_ventas_diarias_fba` (condicional). |
| `amazon_ads_bi.sql` | Crea `amazon_ads_reports`, la vista `v_ads_fba` y `v_profit_real_fba`. |
| `productos_variantes_padre_hijo.sql` | Añade `parent_id` y `heredar_precio` a `productos`, la función `get_effective_price` y triggers de propagación de precios padre → hijo. |
| `sync_v_productos_catalogo_categoria_id.sql` | Recrea `v_productos_catalogo` añadiendo `categoria_id` al final. |
| `dynamic_technical_specs.sql` | Crea `categorias` con `campos_config` JSONB, función de validación y trigger `updated_at`. |
| `product_competitor_benchmark_selection.sql` | Crea `product_competitor_benchmark_selection` (competidores para forecast). |
| `alerts_align_schema.sql` | Alinea el schema completo de `alerts`, defaults, constraints y unique. |

---

## 2. HISTÓRICAS / YA ABSORBIDAS

Scripts que se ejecutaron en una fase anterior y cuyo efecto está ya incorporado
en los scripts canónicos o en la BD. No volver a ejecutar salvo en una BD muy
antigua que no tenga los scripts posteriores.

| Script | Por qué es histórico |
|--------|----------------------|
| `contenedores_estados_flujo.sql` | Normalización temprana del campo `estado` único con `contenedores_estado_chk`. El estado único fue después reemplazado por `estado_logistico/stock/costes` en `contenedores_estados_separados.sql`. Conservar como referencia evolutiva. |
| `contenedores_add_gastos_flete.sql` | Añade `gastos_llegada_puerto` y `flete` a `contenedores`. Estas columnas están ya cubiertas por scripts posteriores de facturación de costes (`fase1_contenedor_facturado_costes.sql`). |
| `variantes_logistica_herencia_padre_backfill.sql` | Backfill de medidas de `producto_logistica` desde padre a hijo. Ejecutar solo si una variante hija sigue sin medidas después de que el padre tenga las suyas. |
| `producto_logistica_cubicaje_backfill.sql` | Backfill de medidas desde `producto_ficha_tecnica` legacy a `producto_logistica`. Ejecutar solo si hay productos con ficha técnica pero sin fila logística. |
| `add_normativas_categorias.sql` | Seed de `campos_config` con normativas europeas para categorías específicas. Los datos ya deben estar en BD si se ejecutó `dynamic_technical_specs.sql`. |

---

## 3. MANUALES / BACKFILL / FIXES TEMPORALES

Scripts que resuelven un problema puntual o normalizan datos y no deben
re-ejecutarse automáticamente. Revisar caso por caso antes de usar.

| Script | Cuándo ejecutar / advertencia |
|--------|-------------------------------|
| `finance_supplier_payments_phase1_alignment.sql` | Alinea la tabla `finance_supplier_payments` si ya existía antes del script canónico. Contiene tres `UPDATE` de normalización de `logistics_type`. Ejecutar solo si la tabla existía previamente sin las columnas añadidas aquí. Verificar con el diagnóstico `finance_supplier_payments_status.sql` antes. |
| `finance_supplier_payments_normalize_logistics_type.sql` | Normaliza `logistics_type` de valores legado (`AGL`, `PROPIO`, `SIN_DEFINIR`) a los valores canónicos del código TypeScript (`amazon_agl`, `propio`, `sin_definir`). Aunque `phase1_alignment.sql` cubre una parte de la misma normalización, **este script es más robusto** (maneja mayúsculas/minúsculas con `upper(trim(...))`) y puede usarse como fix manual si aparecen registros con valores legado. Conservar como herramienta de normalización puntual, no eliminar. |
| `normalize_ventas_diarias_marketplace_id.sql` | Fusiona y normaliza `marketplace_id` null en `ventas_diarias`. Contiene `DELETE`. **Ejecutar siempre el dry-run** `ventas_diarias_marketplace_null_dry_run.sql` antes. No re-ejecutar si ya se aplicó. |
| `fase1_contenedor_facturado_costes.sql` | Añade columnas de facturación a `contenedores` y prorrateo a `producto_costos`. Contiene lógica dinámica para eliminar un constraint legacy y lo recrea con valores que pueden diferir del estado actual (`estado IN ('preparando','en_transito','llegado','entregado','facturado','Borrador')`). Revisar contra `contenedores_estados_separados.sql` antes de ejecutar en BD de producción. |

---

## 4. DUDOSAS / REVISAR ANTES DE EJECUTAR

Scripts cuyo estado exacto en BD no es seguro o que pueden solaparse con
otros de forma no obvia.

| Script | Por qué es dudoso | Acción recomendada |
|--------|-------------------|--------------------|
| `benchmarking_results_table.sql` | La primera línea del fichero contiene un posible typo (`r--` en lugar de `--`). Podría causar error de sintaxis en PostgreSQL. | Verificar sintaxis antes de ejecutar. |
| `amazon_payments_fba.sql` | Contiene un índice antiguo `ventas_diarias_producto_fecha_pais_canal_idx` (sin `marketplace_id`) que es reemplazado por el grano expandido de `ventas_diarias_all_orders_unique.sql`. La función `sync_ventas_diarias_fba` referencia la clave de conflicto antigua. | Verificar si la función ya existe y si el índice antiguo todavía está presente antes de ejecutar. |
| `ordenes_proforma_firmada.sql` | Añade `proforma_firmada_url` y `proforma_firmada_at` a `ordenes_compra`. Estas columnas también aparecen en `ordenes_compra_payment_etd_eta.sql`. Si este último ya se ejecutó, las columnas ya existen y este script es redundante (aunque usa `ADD COLUMN IF NOT EXISTS`). | Verificar si las columnas ya existen antes de ejecutar. |

---

## 5. RLS / POLICIES

Scripts cuya responsabilidad principal es la seguridad a nivel de fila.
Todos son idempotentes (`DROP POLICY IF EXISTS` antes de `CREATE POLICY`).

| Script | Tabla protegida |
|--------|-----------------|
| `finance_supplier_payments_rls.sql` | `finance_supplier_payments` (select, insert, update para `authenticated`) |
| `contenedor_ordenes_rls_policies.sql` | `contenedor_ordenes` (select, insert, delete para `authenticated`) |

---

## 6. ÍNDICES / CONSTRAINTS / UNIQUE

Scripts cuya acción principal es crear índices o restricciones de integridad.

| Script | Qué crea |
|--------|----------|
| `contenedor_ordenes_unique_orden_id.sql` | `ux_contenedor_ordenes_orden_id_unico` sobre `(orden_id)` |
| `contenedor_stock_aplicado_unique_activo.sql` | `ux_contenedor_stock_aplicado_activo` parcial sobre `(contenedor_id, producto_id, pais, canal)` WHERE `revertido_at IS NULL` |
| `producto_costos_contenedor_lote_unique.sql` | `ux_producto_costos_contenedor_producto_lote` sobre `(contenedor_id, producto_id, COALESCE(lote_producto, ''))` |
| `fix_amazon_fba_ledger_unique_key.sql` | Recrea `amazon_fba_inventory_ledger_daily_unique` con grano real (sku_original + fnsku) |
| `ventas_diarias_all_orders_unique.sql` | `ventas_diarias_grain_unique_idx` sobre `(producto_id, fecha, pais, canal_venta, moneda, tipo_cliente, marketplace_id)` |
| `ordenes_compra_agente_id.sql` | `idx_ordenes_compra_agente_id` |

---

## 7. VISTAS / FUNCTIONS / TRIGGERS

Scripts que crean o reemplazan vistas, funciones de base de datos o triggers.
Todos usan `CREATE OR REPLACE` o `CREATE TABLE IF NOT EXISTS` por lo que son
seguros de re-ejecutar para actualizar la definición.

| Script | Objetos creados |
|--------|-----------------|
| `ordenes_compra_moneda.sql` | Función `recalc_orden_totales()` (trigger) |
| `ordenes_compra_payment_etd_eta.sql` | Función `calcular_fecha_pago_balance()` + trigger `trg_calcular_fecha_pago_balance` |
| `productos_variantes_padre_hijo.sql` | Funciones `get_effective_price`, `propagate_parent_prices_to_children`, `sync_child_prices_from_parent` + triggers sobre `producto_precios` y `productos` |
| `forecast_inbound_items.sql` | Vista `v_forecast_inbound_items` |
| `fase2_lotes_coste_medio.sql` | Vista `v_producto_coste_medio` |
| `fase3_stock_entregado.sql` | Función `fn_stock_add` (SECURITY DEFINER) |
| `amazon_fba_inventory_ledger_daily.sql` | Vista `v_product_fba_stock_daily` |
| `amazon_payments_fba.sql` | Vista `v_ventas_fba_payments`, función `sync_ventas_diarias_fba` (condicional) |
| `amazon_ads_bi.sql` | Vistas `v_ads_fba`, `v_profit_real_fba` |
| `sync_v_productos_catalogo_categoria_id.sql` | Vista `v_productos_catalogo` |
| `dynamic_technical_specs.sql` | Función `validar_campos_config`, función y trigger `update_categorias_updated_at` |
| `contenedor_stock_destinos.sql` | Trigger `trg_contenedor_stock_destinos_updated` |
