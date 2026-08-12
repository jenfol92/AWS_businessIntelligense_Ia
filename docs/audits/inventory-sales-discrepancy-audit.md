# Auditoría diferencia ventas Amazon vs Inventario

**Fecha:** 2026-07-13
**Alcance:** Solo lectura. No se modificó lógica FBA, UI Inventario, forecast ni migraciones.
**Síntoma reportado:** Tras `POST /api/cron/amazon-sp-api/reports/fba-sales/import` con `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL`, Inventario muestra V.30d ≈ 145 uds y V.90d ≈ 322 uds (suma DE+ES+FR+GB+PL), mientras Seller Central muestra ~547 uds para el mismo producto.

**Diagnóstico SQL:** `sql/diagnostics/inventory_sales_discrepancy_audit.sql`

---

## 1. Resumen ejecutivo

**Hipótesis más probable (combinación):**

1. **Comparación de métricas distintas:** el ERP cuenta **unidades enviadas FBA** (`GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` → shipped units). Seller Central suele mostrar por defecto **unidades pedidas / ordered** o totales de **ASIN parent** incluyendo variaciones, cancelaciones y estados no enviados.
2. **Un solo `producto_id` en UI vs familia en Amazon:** Inventario agrega ventas **solo del producto seleccionado**, no hace rollup automático de padre + variantes aunque cargue el scope familiar para otras cosas.
3. **Países ocultos en la tabla “Stock por país”:** la tabla solo lista filas de `inventario_paises`. Ventas en IT, BE, NL, PT, AT, UNKNOWN, etc. **no aparecen en la tabla** (aunque sí pueden existir en `ventas_diarias` y en el total global del header).
4. **Orphans / SKUs sin match:** ventas raw con `producto_id IS NULL` no llegan a `ventas_diarias` vía `sync_ventas_diarias_from_amazon_fba_sales`.

La diferencia 547 vs 145/322 **no se puede cerrar sin ejecutar el SQL con el `producto_id` real** y confirmar el periodo exacto de Seller Central. El código explica mecanismos que pueden producir una brecha grande incluso con import correcto.

---

## 2. Qué muestra la UI

### 2.1 Archivos y flujo

| Capa | Archivo | Rol |
|------|---------|-----|
| UI tabla “Stock por país” | `modules/inventory/components/InventoryPage.tsx` | Renderiza `row.salesUnits30` / `row.salesUnits90` como “V.30d” / “V.90d” |
| Filas por país | `modules/inventory/services/buildInventoryProduct.ts` → `buildCountryRowsForProduct()` | Une stock (`inventario_paises`) con ventas por `producto_id::pais` |
| Header “Ventas 30d / Ventas 90d” | `modules/inventory/services/loadInventoryContext.ts` → `applyScopedProductMetrics()` | Suma global del **producto seleccionado** desde `ctx.sales.byProductGlobal` |
| Agregación ventas | `modules/inventory/repositories/inventoryRepository.ts` → `fetchSalesAggregates()` | Lee **`ventas_diarias`** (no raw) |
| Detalle producto API | `app/api/inventory/product/[id]/route.ts` → `buildProductInventoryDetail.ts` | Ensambla countries + price top |
| Precio top por país | `fetchCountryPriceDistribution()` | Lee **`amazon_fba_sales_daily_raw`** con filtro `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` |

### 2.2 Tabla / vista exacta para V.30d y V.90d

- **Fuente:** tabla `ventas_diarias`
- **No usa:** `amazon_fba_sales_daily_raw`, `v_amazon_fba_sales_daily` (estas alimentan sync y precio top, no la columna V.30d/V.90d)

### 2.3 Filtros aplicados

| Filtro | Comportamiento |
|--------|----------------|
| `producto_id` | **Sí.** Solo el producto seleccionado (`targetId`). No suma variantes/hermanos en V.30d/V.90d |
| SKU | **No** filtra ventas por SKU; depende del `producto_id` ya resuelto en import |
| País | Tabla: **país de venta** (`ventas_diarias.pais`), pero **solo países con fila en `inventario_paises`** |
| Stock vs venta | Ventas = país de entrega/venta; stock = país de `inventario_paises` |
| Solo países con stock | **Sí en la tabla.** Países con ventas pero sin fila de stock no se muestran |
| Canal FBA/FBM/ALL | `fetchSalesAggregates` filtra `canal_venta` si canal ≠ ALL |
| `source` | **No filtra.** Incluye todas las filas de `ventas_diarias` (legacy All Orders, Stockagile, SP-API, etc.) salvo filtro de canal |

### 2.4 Ventana temporal

```typescript
// fetchSalesAggregates: carga 90 días; units30 usa windowDays (default 30)
fromDate = today - 90
cutoffWindow = today - windowDays  // típicamente 30
units90 += todas las filas >= fromDate
units30 += filas >= cutoffWindow
```

- **V.90d** = últimos 90 días calendario (UTC date slice en ISO `YYYY-MM-DD`)
- **V.30d** = últimos `windowDays` (default 30), no mes natural

### 2.5 Pipeline FBA (referencia)

```
Cron import → amazon_fba_sales_daily_raw
  report_type = GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL
Vista v_amazon_fba_sales_daily (solo ese report_type)
RPC sync_ventas_diarias_from_amazon_fba_sales
  source = spapi_fba_customer_shipment_sales
  → ventas_diarias
UI Inventario → fetchSalesAggregates → ventas_diarias
```

El cron de import (`fbaForecastSpApiImportsService.ts`) **invoca el sync inline** al finalizar (`ventasDiariasSync`). Verificar en la respuesta JSON: `orphanUnits`, `skippedSourceConflicts`, `insertedUnits`.

---

## 3. Qué hay en raw FBA

Consultas **C, D, I, O, P** en `inventory_sales_discrepancy_audit.sql`.

Puntos clave:

- Solo filas con `raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'` entran en `v_amazon_fba_sales_daily`.
- Filas legacy con otro `report_type` pueden existir en raw pero **no sincronizan** a `ventas_diarias`.
- `producto_id` se resuelve en import vía `resolveProductMatchesBySku()`; sin match → orphan (`producto_id NULL`).
- País: `ship_to_country` → `pais` en vista/sync.
- Métrica: **`quantity` = unidades enviadas**, no pedidas.

---

## 4. Qué llega a ventas_diarias

Consultas **E, F, G, L** en el SQL de diagnóstico.

Sync (`sql/migrations/20260709_sync_ventas_diarias_from_amazon_fba_sales.sql`):

- INSERT desde `v_amazon_fba_sales_daily` donde `producto_id IS NOT NULL`
- **Excluye** filas con conflicto de grano (`source` distinto ya existente) → `skippedSourceConflicts`
- Orphans en raw (`producto_id NULL`) se reportan pero **no insertan**

Si **G** muestra `raw_units > ventas_diarias_units` → problema de sync, conflicts o vista.
Si **raw ≈ ventas_diarias** pero ambos << 547 → problema de matching, periodo o comparación Amazon.

---

## 5. Países ocultos / no visibles

Consultas **J, K, N**.

`buildCountryRowsForProduct()` itera **solo** `inventario_paises` del `producto_id`:

```47:86:modules/inventory/services/buildInventoryProduct.ts
export function buildCountryRowsForProduct(
  productId: string,
  ctx: InventoryContext,
): InventoryCountryStockRow[] {
  const rows = ctx.inventoryRows.filter((r) => r.producto_id === productId);
  // ...
  for (const inv of rows) {
    const sales =
      ctx.sales.byProductCountry.get(salesKey(productId, inv.pais)) ??
      ({ units30: 0, units90: 0 } as SalesAgg);
```

**Efecto:** ventas en IT, BE, NL, PT, AT, SE, UNKNOWN, etc. no aparecen en la tabla aunque existan en `ventas_diarias`.

**Importante:** el header “Ventas 30d/90d” usa `byProductGlobal` (todos los países). Si el usuario sumó manualmente las filas visibles (145 / 322), puede **subestimar** respecto al header si hay países ocultos. En el caso reportado, si header = suma de filas, probablemente **no hay ventas SP-API en otros países** para ese `producto_id`, y la brecha vs Amazon viene de otro factor (familia ASIN, periodo, ordered vs shipped).

Datos observados (solo países visibles):

| País | V.30d | V.90d |
|------|-------|-------|
| DE | 28 | 54 |
| ES | 40 | 72 |
| FR | 31 | 94 |
| GB | 46 | 102 |
| PL | 0 | 0 |
| **Suma** | **145** | **322** |

---

## 6. Orphans / SKUs sin match

Consulta **H** (+ respuesta cron `orphanRows` / `orphanUnits`).

Durante import (`fbaForecastSpApiImportsService.ts`):

```typescript
producto_id: match?.productoId ?? null,
// warning: "Sin match de producto para venta FBA SKU ..."
```

Ventas de SKUs Amazon no mapeados a `productos` quedan en raw sin `producto_id` y **nunca** entran en `ventas_diarias` ni en Inventario.

---

## 7. Parent / variantes

Consultas **B, M**.

- `productos` tiene `parent_id` y `asin` (no `parent_sku` ni `ean` en tabla base; EAN en `producto_logistica.ean_upc`).
- `fetchInventoryProductScope()` carga padre + hermanos/hijos para contexto, pero **`fetchSalesAggregates` se consulta para todos los IDs del scope mientras la UI muestra ventas solo de `targetId`**.
- Selector padre/variante en `InventoryPage.tsx` cambia `targetId`; cada variante tiene sus propias ventas en `ventas_diarias`.
- **Amazon Seller Central** a menudo agrega por **ASIN parent** todas las variaciones. Si 547 es total de familia y el ERP muestra una variante → diferencia esperada.

---

## 8. Diferencia ordered vs shipped

| | Amazon Seller Central (típico) | ERP Inventario |
|--|--------------------------------|----------------|
| Métrica | Unidades **pedidas** (Ordered), a veces netas de canceladas | Unidades **enviadas FBA** (Fulfilled Shipments) |
| Report SP-API | Business Reports / Detail Page Sales | `GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL` |
| Canceladas/pending | Pueden contarse o mostrarse aparte | No entran hasta envío |
| Variaciones | ASIN parent rollup | Un `producto_id` |

**547 − ~40 canceladas/pending ≈ 507** sigue siendo >> 322 (90d) y >> 145 (30d) → no explica solo con cancelaciones; hay que alinear **periodo** y **alcance ASIN/SKU**.

---

## 9. Conclusión

| Área | ¿Es causa probable? | Notas |
|------|---------------------|-------|
| Importación raw | Posible parcial | Verificar cobertura fechas (P), report_type legacy (O) |
| Matching SKU → producto_id | **Alta** | Orphans (H), SKUs hermanos (I, M) |
| Sync raw → ventas_diarias | Media | Comparar G; revisar `skippedSourceConflicts` |
| Filtro UI (países stock) | Media | K, N — oculta países sin `inventario_paises` |
| Un solo producto vs familia Amazon | **Alta** | M — no rollup de variantes |
| Comparación Amazon (periodo/métrica) | **Alta** | ordered vs shipped, 30d vs 90d vs custom |
| Canal ALL vs FBA en UI | Baja | Solo si canal ≠ FBA y hay mezcla |

**Veredicto:** La brecha es **muy probablemente una combinación** de (a) comparar ordered/parent ASIN en Amazon contra shipped/single `producto_id` en ERP, y (b) posibles orphans o ventas en SKUs de variante no seleccionada. Menos probable que sea solo un bug de sync si el cron completó sin errores y G cuadra.

---

## 10. Recomendación técnica (sin implementar)

1. Ejecutar `sql/diagnostics/inventory_sales_discrepancy_audit.sql` sustituyendo `product_id` y `sku` reales.
2. Pedir al usuario captura de Seller Central con: periodo exacto, métrica (ordered/shipped), ASIN (parent vs child), marketplace.
3. Comparar consulta **M** (familia) vs total Amazon 547.
4. Si **H** o **I** muestran unidades significativas en orphans/otros SKUs → corregir catálogo/matching (fuera de alcance de esta auditoría).
5. Si **K** muestra países ocultos con ventas → decidir si Inventario debe mostrar países con ventas aunque stock = 0 (cambio UI, no hecho aquí).
6. Guardar respuesta JSON del cron: `orphanUnits`, `skippedSourceConflicts`, `insertedUnits`, rango de fechas importado.

---

## Fase 3 — Qué pedir al usuario para comparar con ~547 uds

Antes de cerrar la discrepancia numérica, confirmar:

| Pregunta | Por qué importa |
|----------|-----------------|
| ¿547 es últimos **30**, **90** días, YTD o periodo personalizado? | ERP V.30d=145, V.90d=322 — hay que comparar la misma ventana |
| ¿547 son unidades **pedidas** o **enviadas**? | ERP usa Fulfilled **Shipments** (enviadas) |
| ¿Incluye canceladas, pendientes, devoluciones? | ~40 mencionadas — aclarar si Amazon las resta o no |
| ¿Es ASIN **parent** o variante concreta? | ERP filtra por un `producto_id` / variante |
| ¿Es un SKU concreto o suma de variaciones? | Consultas B, I, M |
| ¿Paneuropeo o marketplace concreto (ej. amazon.es)? | `marketplace_id` / `ship_to_country` en raw |
| ¿Filtro por país de venta o de entrega? | ERP usa `ship_to_country` → `pais` |
| ¿Se ejecutó solo import o también sync? | Import incluye sync inline; verificar JSON de respuesta |

---

## Fase 5 — Validación build

| Comando | Resultado |
|---------|-----------|
| `npx.cmd tsc --noEmit` | **OK** (exit 0) |
| `npm.cmd run build` | **OK** (exit 0, Next.js 14.2.35, compiled successfully) |

No se observaron `PageNotFoundError` en `/[locale]/coo` ni fallos de Google Fonts/red durante el build.

---

## Archivos revisados

- `modules/inventory/components/InventoryPage.tsx`
- `modules/inventory/services/buildInventoryProduct.ts`
- `modules/inventory/services/buildProductInventoryDetail.ts`
- `modules/inventory/services/loadInventoryContext.ts`
- `modules/inventory/repositories/inventoryRepository.ts`
- `modules/amazon-sp-api/fbaForecastSpApiImportsService.ts`
- `modules/amazon-sp-api/skuProductMatching.ts`
- `app/api/cron/amazon-sp-api/reports/fba-sales/import/route.ts`
- `sql/migrations/20260709_sync_ventas_diarias_from_amazon_fba_sales.sql`
- `sql/migrations/20260710_update_v_amazon_fba_sales_daily_to_amazon_fulfilled_shipments.sql`
- `sql/diagnostics/fba_amazon_fulfilled_shipments_import_check.sql`

---

## Queries principales a ejecutar primero

1. **A** — confirmar producto y parent
2. **M** — ventas familia vs producto solo
3. **L** — total ventas_diarias 30d/90d
4. **G** — raw vs ventas_diarias por país
5. **H** — orphans
6. **K** — países con ventas sin stock UI
7. **P** — cobertura temporal import
