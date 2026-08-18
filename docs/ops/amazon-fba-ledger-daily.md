# Inventory Ledger diario FBA

Fuente de distribucion fisica, reconciliacion e historico FBA. No es la
fuente de disponibilidad operativa EU/UK:

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
marketplace_country = EU
marketplace_id = NULL
frequency_minutes = 1440
enabled = true
```

La fila se activa de forma idempotente mediante
`sql/data/20260814_activate_daily_fba_ledger_schedule.sql`. El scope `EU`
pertenece al lock del scheduler; `marketplace_id = NULL` hace que el owner
canonico reutilice los siete marketplaceIds configurados y emita un unico
reporte multinacional. No representa siete stocks ni siete requests.

El cron existente corre cada hora. Tomando como baseline el primer Ledger
validado a las 10:10 UTC, la primera ventana diaria posterior queda en el cron
de las 11:00 UTC. Esa hora deja terminado el dia UTC anterior con margen y
mantiene una cadencia de 1440 minutos. `next dev` no ejecuta Vercel Cron.

El scheduler ejecuta:

1. `pollPendingAmazonReportJobs`
2. `previewReadyAmazonReportJobs`
3. `commitReadyAmazonReportJobs`
4. `requestDueAmazonReportSchedules`

Un job abierto o compatible para la misma fecha/opciones se reutiliza. Los
ciclos posteriores hacen polling del mismo `reportId`; al llegar a `DONE`, el
owner descarga, previsualiza y hace commit canonico. Filas unlinked y
`unknownConditionRows` no bloquean Ledger; warnings de parser y conflictos de
identidad si lo bloquean.

La frescura fisica reutiliza el contrato existente de 72 horas. Un fallo no
borra el ultimo snapshot valido: los consumidores siguen mostrando el ultimo
Ledger persistido junto con `snapshot_date`, `last_imported_at`, `stale_days` e
`is_stale`.

El mismo scheduler sigue soportando `GET_AFN_INVENTORY_DATA_BY_COUNTRY`, pero ese informe queda como auxiliar de metadatos/condicion y local fulfillment, no como stock FBA principal.

## Ejecucion

No existe una pantalla operativa de importaciones. El Ledger historico pertenece
al scheduler de reportes y se procesa desde el unico pipeline
`/api/cron/amazon/reports/run` cuando exista deployment. El stock actual se
actualiza desde Inventario mediante `syncAmazonInventoryCanonical()`.

## Antes de importar

1. Ejecutar `sql/diagnostics/fba_ledger_contract_remote_precheck_readonly.sql`.
2. Revisar `docs/ops/amazon-fba-ledger-contract-repair.md`.
3. No aplicar 20260715 ni 20260814_01. La candidata consolidada es
   `sql/migrations/20260814_02_fba_ledger_contract_consolidated.sql`.
4. No crear schedule hasta completar precheck, backup, migracion y commit controlado.
