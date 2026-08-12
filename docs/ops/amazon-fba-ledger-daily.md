# Inventory Ledger diario FBA

Fuente canonica de stock FBA operativo por pais:

- Reporte Amazon: `GET_LEDGER_SUMMARY_VIEW_DATA`
- `reportOptions.aggregateByLocation`: `COUNTRY`
- `reportOptions.aggregatedByTimePeriod`: `DAILY`
- Fecha solicitada: ultimo dia UTC completo (`YYYY-MM-DDT00:00:00Z` a `YYYY-MM-DDT23:59:59Z`)
- Cantidad principal: `Ending Warehouse Balance`

## Ejecucion automatica

El flujo productivo usa la cola existente `amazon_spapi_report_jobs` y el scheduler existente:

```text
POST /api/cron/amazon/reports/run
Authorization: Bearer ${CRON_SECRET}
```

Para que el cron solicite Ledger diario debe existir una fila habilitada en `amazon_report_schedules` con:

```text
report_type = GET_LEDGER_SUMMARY_VIEW_DATA
enabled = true
```

El scheduler ejecuta:

1. `pollPendingAmazonReportJobs`
2. `previewReadyAmazonReportJobs`
3. `commitReadyAmazonReportJobs`
4. `requestDueAmazonReportSchedules`

El mismo scheduler sigue soportando `GET_AFN_INVENTORY_DATA_BY_COUNTRY`, pero ese informe queda como auxiliar de metadatos/condicion y local fulfillment, no como stock FBA principal.

## Ejecucion manual

La pantalla `/importar` usa:

```text
POST /api/amazon/sp-api/reports/fba-ledger/run
```

Acciones:

- `request`: crea job y devuelve `jobId`
- `poll`: actualiza estado hasta `DONE`
- `commit`: descarga, parsea e importa el documento

El endpoint requiere usuario autenticado y rol admin; no usa ni expone `CRON_SECRET`.

## Antes de importar

1. Ejecutar `sql/diagnostics/fba_ledger_canonical_pre_migration_check.sql`.
2. Aplicar `sql/migrations/20260715_fba_ledger_daily_canonical_stock.sql` en Supabase SQL Editor.
3. Pulsar `Actualizar Inventory Ledger diario` en `/importar`.
