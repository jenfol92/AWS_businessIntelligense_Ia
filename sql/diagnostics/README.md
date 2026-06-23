# sql/diagnostics/

Scripts de consulta para inspeccionar el estado de la base de datos.

Los diagnósticos **no modifican el esquema**. Algunos contienen sentencias
`UPDATE` o `DELETE` que deben considerarse operaciones manuales controladas y
no diagnósticos de solo lectura; están marcados explícitamente.

Ejecutar en el **SQL Editor de Supabase** o con `psql` contra la BD del proyecto.

Actualizado: FASE A-3B1 (2026-06-19).

---

## 1. Diagnósticos canónicos recomendados

Scripts con cobertura amplia y reutilizable que se recomienda mantener como
referencia permanente.

| Script | Qué informa |
|--------|-------------|
| `finance_supplier_payments_status.sql` | Estado completo de `finance_supplier_payments`: conteo total, órdenes confirmadas sin pago, duplicados, distribución de `logistics_type`, columnas reales, índice de idempotencia, RLS y policies activas. Ejecutar después de cualquier backfill o migración de pagos. |
| `finance_payments_calendar_diagnostic.sql` | Visión financiera global: pagos proveedor con orden y contenedor, duplicados, tipo logístico, fechas BALANCE_70, líneas de crédito, movimientos, contenedores con órdenes confirmadas. Complementa a `finance_supplier_payments_status.sql` con la parte de `credit_lines`. |
| `contenedor_ordenes_rls_diagnostic.sql` | Estado RLS de `contenedores`, `contenedor_ordenes` y `ordenes_compra`: `rowsecurity`, policies vigentes, vínculos contenedor-orden. Ejecutar antes y después de aplicar `contenedor_ordenes_rls_policies.sql`. |
| `contenedor_ordenes_ordenes_duplicadas.sql` | Detecta órdenes vinculadas a más de un contenedor. **Ejecutar obligatoriamente antes de aplicar** `contenedor_ordenes_unique_orden_id.sql`. |
| `logistica_contenedor_ordenes_y_llegadas_diagnostic.sql` | Diagnóstico combinado: vínculos contenedor-orden, líneas de orden, criterio de aparición en Llegadas previstas y estado de los estados separados. Diagnóstico canónico de llegadas/logística. |
| `contenedores_estados_separados_diagnostic.sql` | Valida que cada contenedor tenga `estado_logistico`, `estado_stock`, `estado_costes` y `tipo_contenedor` rellenos. Detecta registros `LEGACY_SIN_MAPEAR` y `FALTA_*`. Ejecutar después de `contenedores_estados_separados.sql`. |
| `contenedor_facturacion_costes_diagnostic.sql` | Simula la facturación de costes por contenedor: CBM, prorrateo de flete/gastos/tránsito, coste unitario calculado y estado del contenedor. Útil antes de ejecutar la facturación real. |
| `inventory_fba_stock_discrepancy.sql` | Compara `inventario_paises` con el último snapshot de `v_product_fba_stock_daily`. Incluye trazabilidad desde `contenedor_stock_aplicado`. |
| `fba_inventory_by_country_product.sql` | Valida stock FBA por país en `inventario_paises` y en `fba_country_stock_daily` tras un import AFN by country. |
| `ventas_diarias_marketplace_null_dry_run.sql` | **Dry-run obligatorio** antes de ejecutar `normalize_ventas_diarias_marketplace_id.sql`. Cuantifica filas null, duplicados y simulación de merge. |

---

## 2. Diagnósticos temporales

Scripts creados para resolver un problema concreto o investigar un caso
específico. Pueden seguir siendo útiles pero no tienen el alcance de los
diagnósticos canónicos.

| Script | Contexto / cuándo usar |
|--------|------------------------|
| `flujo_costes_producto_orden_lote.sql` | Traza coste producto → orden → lote → `producto_costos` para los SKUs ZIPPY. Útil si se investiga un problema de coste en una variante. Parametrizable ampliando los SKUs del WITH inicial. |
| `orders_costs_and_reopen_diagnostic.sql` | Lista histórico de `producto_costos`, `orden_items` y cabeceras para revisar apertura/congelación de órdenes. Útil para depurar reaperturas manuales. |
| `cbm_fuente_verdad_logistica.sql` | Compara medidas de caja entre `producto_ficha_tecnica` (legacy) y `producto_logistica` (actual). Útil si se sospecha que CBM difiere entre fuentes para algún producto. |
| `stockout_correction_product.sql` | Días con/sin stock FBA por mes y ventas mensuales históricas para un producto. Requiere sustituir `<PRODUCT_ID>` por el UUID real antes de ejecutar. |
| `ventas_diarias_product.sql` | Compara `ventas_diarias` y `amazon_all_orders_items` staging para un SKU concreto. Cambiar el SKU en el `WHERE` antes de ejecutar. |

---

## 3. Diagnósticos duplicados o absorbidos por otros

Scripts cuya información está cubierta total o parcialmente por otro diagnóstico
canónico. Se conservan sin modificar para referencia; se recomienda usar el
canónico en su lugar.

| Script | Absorbido por | Nota |
|--------|---------------|------|
| `llegadas_previstas_contenedores_diagnostic.sql` | `logistica_contenedor_ordenes_y_llegadas_diagnostic.sql` | Subconjunto del diagnóstico combinado. Incluye `estado_stock` y `estado_costes` pero no los vínculos de órdenes. Conservar si se necesita una vista rápida sin el JOIN a órdenes. |
| `llegadas_previstas_rango_estado_diagnostic.sql` | `logistica_contenedor_ordenes_y_llegadas_diagnostic.sql` | Vista de estado visual con categorización `PENDIENTE_ATRASADO / PENDIENTE / ENTREGADO`. Conservar si se necesita solo el rango ETA sin el detalle de órdenes. |

---

## 4. Diagnósticos de finanzas

Scripts orientados a `finance_supplier_payments`, `finance_credit_lines` y
flujos de pago a proveedor.

| Script | Alcance |
|--------|---------|
| `finance_supplier_payments_status.sql` | Estado completo de pagos proveedor (canónico). Ver sección 1. |
| `finance_payments_calendar_diagnostic.sql` | Pagos proveedor + credit lines + contenedores (canónico). Ver sección 1. |

---

## 5. Diagnósticos de contenedores / llegadas

Scripts orientados a `contenedores`, `contenedor_ordenes`, estados y llegadas
previstas.

| Script | Canónico | Nota |
|--------|----------|------|
| `logistica_contenedor_ordenes_y_llegadas_diagnostic.sql` | Sí | Diagnóstico combinado principal. |
| `contenedor_ordenes_rls_diagnostic.sql` | Sí | RLS y vínculos. |
| `contenedor_ordenes_ordenes_duplicadas.sql` | Sí | Prerrequisito del índice único. |
| `contenedores_estados_separados_diagnostic.sql` | Sí | Valida estados separados. |
| `contenedor_facturacion_costes_diagnostic.sql` | Sí | Simula facturación. |
| `llegadas_previstas_contenedores_diagnostic.sql` | No | Absorbido; ver sección 3. |
| `llegadas_previstas_rango_estado_diagnostic.sql` | No | Absorbido; ver sección 3. |

---

## 6. Diagnósticos de inventario / Amazon

Scripts orientados a `inventario_paises`, `ventas_diarias`, FBA, stock y datos
Amazon.

| Script | Qué informa |
|--------|-------------|
| `inventory_fba_stock_discrepancy.sql` | Compara `inventario_paises` vs snapshot FBA (canónico). Ver sección 1. |
| `fba_inventory_by_country_product.sql` | Valida stock FBA por país post-import (canónico). Ver sección 1. |
| `ventas_diarias_marketplace_null_dry_run.sql` | Dry-run de normalización marketplace_id (canónico previo a migración). Ver sección 1. |
| `ventas_diarias_product.sql` | Ventas de un SKU por país/canal y comparación vs staging All Orders. Temporal; parametrizar antes de usar. |
| `stockout_correction_product.sql` | Días sin stock y ventas mensuales por producto. Temporal; requiere UUID real. |

---

## 7. Scripts con sentencias de escritura

Los siguientes archivos están en `diagnostics/` pero contienen `UPDATE` o `DELETE`
reales y deben tratarse como **operaciones manuales controladas**, no como
diagnósticos de solo lectura.

| Script | Sentencias de escritura | Advertencia |
|--------|------------------------|-------------|
| `orden_items_cbm_cero_backfill.sql` | `UPDATE public.orden_items` | Actualiza `cbm_unitario` en líneas con valor 0. Contiene referencias a `ORD-2026-001`. Revisar el WHERE antes de ejecutar en producción. |

---

## 8. Diagnósticos temporales específicos de producto (conservar como histórico)

Scripts creados para depurar casos concretos de variantes ZIPPY/ROCKY.
Se conservan sin modificar como referencia histórica.

| Script | Caso original |
|--------|---------------|
| `zippy_herencia_logistica_padre.sql` | Validación herencia logística padre → variantes ZIPPY. |
| `zippy_coste_efectivo_fallback_padre.sql` | Fallback de coste efectivo al padre para ZIPPY. |
| `cbm_producto_logistica_orden_items.sql` | CBM del SKU ROCKY (8436616610470) y sus `orden_items`. |
