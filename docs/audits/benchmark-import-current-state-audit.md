# Benchmark import current state audit

Fecha: 2026-07-13

Alcance: auditoria tecnica del estado actual de benchmark de competidores / Helium 10. No se han revisado ni modificado Forecast, Inventario, Amazon FBA, Stockagile, All Orders, source null legacy ni migraciones destructivas.

## Resumen ejecutivo

- No hay importador CSV/XLSX operativo para Helium 10 en el codigo actual.
- El sistema ya puede leer y consumir filas existentes en `competitor_benchmark_snapshots`.
- La UI actual permite seleccionar competidores ya cargados y configurar su uso en forecast, pero no subir archivos.
- El formato interno actual encaja mejor con un export tipo Xray / Black Box de lista de competidores que con un Sales History por ASIN.
- El archivo `B0DDPRML5J-sales-1y.csv` no encaja con el modelo actual porque es una serie temporal por ASIN (`Time`, `Sales`, `Trend Line`, `7-Day Moving Average`) y el ERP espera snapshots agregados con ventas mensuales estimadas.

## Pantallas actuales

Pantalla encontrada:

- `modules/products/components/form/ProductForm.tsx`
- `modules/products/components/form/ProductFormShell.tsx`
- `modules/products/components/ProductBenchmarkingPanel.tsx`

La pestana `Benchmarking` vive dentro del formulario de producto. Solo se habilita cuando el producto ya tiene `productId`. En esa pestana se muestran competidores ya existentes para el producto y se puede editar:

- seleccionado / no seleccionado
- usar para forecast / no usar
- peso
- capture percent
- notas
- configuracion de forecast del producto

No hay `input type="file"`, boton de importacion, preview CSV/XLSX ni pantalla de mapeo de columnas. El propio estado vacio del panel indica que la importacion CSV/Excel de Helium10 queda para una fase posterior.

## Endpoints actuales

Endpoints relacionados encontrados:

- `GET /api/products/[id]/benchmarking/competitors`
  - Lee competidores desde `competitor_benchmark_snapshots`.
  - Parametros: `marketplaceCountry`, `limit`.
  - No acepta archivo.

- `PUT /api/products/[id]/benchmarking/selection`
  - Guarda seleccion manual en `product_competitor_benchmark_selection`.
  - Body JSON con `marketplaceCountry` y `competitors[]`.
  - No acepta archivo.

- `GET/PUT /api/planning/products/[productId]/supply-config/forecast`
  - Configura metodo de forecast y pesos/captura.
  - No importa benchmark.

No se ha encontrado endpoint tipo `/benchmarking/import`, `/helium10/import` o equivalente.

## Tablas y destino actual

### `competitor_benchmark_snapshots`

Es la fuente historica que leen producto, planner e inventario. No se ha encontrado en el repositorio una migracion que cree esta tabla; el codigo la asume existente.

Columnas usadas por los lectores actuales:

- `id`
- `producto_id`
- `candidate_sku`
- `marketplace_country`
- `competitor_asin`
- `competitor_title`
- `snapshot_date`
- `price`
- `rating`
- `review_count`
- `estimated_monthly_units`
- `estimated_monthly_revenue`
- `bsr`
- `source`

No se han encontrado columnas actuales para `brand` o `category`.

### `product_competitor_benchmark_selection`

Creada en `sql/migrations/product_competitor_benchmark_selection.sql`.

Guarda flags de seleccion y parametrizacion manual por producto, marketplace y ASIN competidor:

- `is_selected`
- `use_for_forecast`
- `weight`
- `capture_pct`
- `snapshot_id`
- `notes`

Esta tabla no es historico de metricas. Sirve para filtrar que snapshots entran o no en forecast.

### `benchmarking_results`

Definida en `sql/migrations/benchmarking_results_table.sql`.

Es una tabla legacy/separada para analisis Amazon en JSON (`specifications`, `amazon_products`, `market_analysis`, `recommendations`). No es la fuente usada por el forecast actual de competidores. El modulo `modules/amazon/benchmarking` existe como esqueleto, pero sus archivos estan vacios.

## Formato actualmente soportado

No hay formato CSV/XLSX soportado hoy por el ERP para importar Helium 10.

El formato logico que el ERP podria consumir si las filas ya estuvieran insertadas en `competitor_benchmark_snapshots` es:

- producto destino: `producto_id` o `candidate_sku`
- pais/marketplace: `marketplace_country`
- ASIN competidor: `competitor_asin`
- titulo: `competitor_title`
- fecha snapshot: `snapshot_date`
- precio: `price`
- rating: `rating`
- reviews: `review_count`
- unidades mensuales estimadas: `estimated_monthly_units`
- ingresos mensuales estimados: `estimated_monthly_revenue`
- BSR: `bsr`
- origen: `source`

## Encaje con Helium 10

### Xray / Black Box

Es el formato recomendable para la siguiente fase, porque se parece al modelo actual de snapshots agregados.

Mapeo probable:

- `ASIN` -> `competitor_asin`
- `Title` / `Product Name` -> `competitor_title`
- `Price` -> `price`
- `Monthly Sales` / `Sales` / `Estimated Monthly Sales` -> `estimated_monthly_units`
- `Monthly Revenue` / `Revenue` -> `estimated_monthly_revenue`
- `Reviews` -> `review_count`
- `Rating` -> `rating`
- `BSR` -> `bsr`

Campos que habria que aportar fuera del CSV o derivar en importacion:

- `producto_id` o `candidate_sku`
- `marketplace_country`
- `snapshot_date`
- `source`

Campos Helium sin destino actual claro:

- `Brand`
- `Category`

### Sales History por ASIN

No esta soportado por el modelo actual.

El formato `Time`, `Sales`, `Trend Line`, `7-Day Moving Average` representa una serie temporal de un ASIN. El forecast actual no consume historicos diarios/semanales de competidores; consume `estimated_monthly_units` por snapshot y aplica mediana/captura.

Conclusion: `B0DDPRML5J-sales-1y.csv` no es importable ni utilizable directamente en el estado actual.

## Uso en Forecast e Inventario

Consumos encontrados:

- `modules/planner/repositories/plannerRepository.ts`
  - Lee `competitor_benchmark_snapshots` por `producto_id` y por `candidate_sku`.
  - Aplica filtros de `product_competitor_benchmark_selection` cuando existen.

- `modules/planner/services/buildProductForecast.ts`
  - Decide si hay benchmark usable por `estimatedMonthlyUnits > 0`.
  - Usa `COMPETITOR_BENCHMARK` y `MIXED` cuando procede.

- `modules/planner/services/newProductForecast.ts`
  - Calcula forecast a partir de la mediana positiva de unidades mensuales de competidores.
  - Aplica capture percent configurado o cuota por escenario.

- `modules/inventory/repositories/inventoryRepository.ts`
  - Lee `competitor_benchmark_snapshots` por producto o SKU.
  - Filtra por seleccion manual.

- `modules/inventory/services/buildAnnualInventoryForecast.ts`
  - Usa la mediana de `estimated_monthly_units`.
  - Aplica `competitorCapturePct`.
  - Genera forecast anual con ramp-up y fallback si no hay benchmark.

## Diagnostico SQL creado

Archivo:

- `sql/diagnostics/benchmark_current_structure_audit.sql`

Incluye consultas SELECT-only para revisar:

- existencia de tablas relevantes
- columnas actuales
- constraints e indices
- volumen por `source` y `marketplace_country`
- filas usables por Forecast/Inventario
- calidad de snapshots incompletos
- posibles duplicados
- estado de seleccion manual
- volumen de `benchmarking_results` legacy

## Recomendacion

Para preparar una futura importacion, exportar desde Helium 10 un CSV tipo Xray / Black Box de lista de productos competidores.

No exportar Sales History como formato principal para esta fase, porque hoy el ERP no lo consume y requeriria otro modelo de datos o una transformacion previa a snapshots mensuales.

Siguiente fase recomendable:

1. Crear importador read-only/preview para Xray / Black Box en la pestana Benchmarking del producto.
2. Exigir producto destino y marketplace.
3. Mapear columnas Helium a `competitor_benchmark_snapshots`.
4. Previsualizar cambios antes de insertar.
5. Insertar historico sin borrar snapshots previos.
